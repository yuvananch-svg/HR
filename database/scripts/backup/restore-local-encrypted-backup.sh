#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
fail() { printf 'local restore rehearsal failed: %s\n' "$1" >&2; exit 2; }
[[ $# -eq 3 ]] || fail 'usage: AGE_IDENTITY_FILE=/private/key RESTORE_DB_URL=... ./restore-local-encrypted-backup.sh BACKUP.tar.age BACKUP.tar.age.manifest.json dedicated_local_db_name'
encrypted=$1
manifest=$2
db_name=$3
[[ -f "$encrypted" && ! -L "$encrypted" ]] || fail 'encrypted backup must be a regular file'
[[ -f "$manifest" && ! -L "$manifest" ]] || fail 'manifest must be a regular file'
[[ "$db_name" =~ ^hr_restore_[a-z0-9_]+$ ]] || fail 'database name must start hr_restore_'
[[ "${RESTORE_DB_URL:-}" =~ ^postgres(ql)?:// ]] || fail 'RESTORE_DB_URL is required through the environment'
[[ -n "${AGE_IDENTITY_FILE:-}" && -f "$AGE_IDENTITY_FILE" && ! -L "$AGE_IDENTITY_FILE" ]] || fail 'AGE_IDENTITY_FILE must point to the private age identity file'
for tool in age tar psql sha256sum python3 find shred basename cut; do command -v "$tool" >/dev/null 2>&1 || fail "required tool unavailable: $tool"; done
psql_version=$(psql --version 2>/dev/null) || fail 'cannot read psql version'
[[ "$psql_version" =~ ^psql\ \(PostgreSQL\)\ 17\. ]] || fail 'PostgreSQL 17 psql is required for this known PG17.6 project'

tmp=$(mktemp -d "${TMPDIR:-/tmp}/sb-restore.XXXXXXXX") || fail 'cannot create private restore directory'
chmod 700 "$tmp"
cleanup() {
  local rc=$?
  trap - EXIT
  if ! find "$tmp" -type f -exec shred -u -- {} + 2>/dev/null || ! rmdir "$tmp" 2>/dev/null; then
    printf 'restore cleanup failed; private temporary files may remain in %s\n' "$tmp" >&2
    rc=2
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$encrypted" "$manifest" > "$tmp/manifest-values" <<'PY' || fail 'manifest invalid or ciphertext hash mismatch'
import hashlib, json, sys
blob, mf = sys.argv[1:]
m=json.load(open(mf, encoding="utf-8"))
digest=hashlib.sha256()
with open(blob,"rb") as f:
    for chunk in iter(lambda:f.read(1024*1024),b""): digest.update(chunk)
if m.get("format") != "supabase-db-logical-backup-v1" or m.get("encrypted_sha256") != digest.hexdigest(): raise SystemExit(1)
expected=["auth-customizations.sql","data.sql","migration-history-data.sql","migration-history-schema.sql","roles.sql","schema.sql"]
if sorted(m.get("components",[])) != expected: raise SystemExit(1)
print(m["project_ref"])
print(m["auth_customization_source_sha256"])
print(m.get("component_sha256",{}).get("auth-customizations.sql",""))
PY
mapfile -t manifest_values < "$tmp/manifest-values"
project_ref=${manifest_values[0]}
[[ "$project_ref" =~ ^[a-z0-9]{20}$ ]] || fail 'manifest has invalid project reference'
case "$(basename "$encrypted")" in "supabase-db-$project_ref-"*.tar.age) ;; *) fail 'archive name does not match manifest project reference' ;; esac
source_digest=${manifest_values[1]}
[[ "$source_digest" =~ ^[a-f0-9]{64}$ ]] || fail 'manifest has invalid auth customization source hash'
repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
[[ "$(sha256sum "$repo_root/database/hr_accounts.sql" | cut -d' ' -f1)" == "$source_digest" ]] || fail 'Auth customization source SQL has changed since backup creation; review and regenerate recovery component'
auth_component_digest=${manifest_values[2]}
[[ "$auth_component_digest" =~ ^[a-f0-9]{64}$ ]] || fail 'manifest has invalid auth customization component hash'
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$tmp/backup.tar" "$encrypted" 2>/dev/null || fail 'decryption failed'
# Validate exact names, regular-file type, and no links/directories before extracting.
python3 - "$tmp/backup.tar" > "$tmp/archive-checked" <<'PY' || fail 'archive has unexpected names or unsafe member types'
import sys, tarfile
expected={"roles.sql","schema.sql","data.sql","migration-history-schema.sql","migration-history-data.sql","auth-customizations.sql"}
with tarfile.open(sys.argv[1],"r:") as t:
    ms=t.getmembers()
    if {m.name for m in ms} != expected or len(ms)!=len(expected) or any(not m.isfile() or m.name.startswith("/") or ".." in m.name.split("/") for m in ms): raise SystemExit(1)
    for m in ms: print(m.name)
PY
tar -C "$tmp" -xf "$tmp/backup.tar" || fail 'archive extraction failed'
for f in roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql auth-customizations.sql; do [[ -s "$tmp/$f" ]] || fail "missing/empty archive member: $f"; done
[[ "$(sha256sum "$tmp/auth-customizations.sql" | cut -d' ' -f1)" == "$auth_component_digest" ]] || fail 'Auth customization SQL hash mismatch'

# Parse and constrain the restore target. Supabase local stack must already be
# initialized on loopback, with managed auth.users baseline but no app tables/data.
export RESTORE_DB_NAME="$db_name"
python3 > "$tmp/restore-connection.json" <<'PY' || fail 'RESTORE_DB_URL must target loopback and the exact dedicated database name'
import json, os, sys
from urllib.parse import unquote, urlsplit
u=urlsplit(os.environ["RESTORE_DB_URL"])
if u.scheme not in ("postgres","postgresql") or u.hostname != "127.0.0.1" or not u.port or not u.username or not u.password or u.path != "/"+os.environ["RESTORE_DB_NAME"] or u.query or u.fragment: raise SystemExit(1)
vals=[u.username,unquote(u.password),u.hostname,str(u.port),os.environ["RESTORE_DB_NAME"]]
if any("\n" in v or "\r" in v for v in vals): raise SystemExit(1)
json.dump(dict(zip(("user","password","host","port","database"),vals)),sys.stdout)
PY
mapfile -t restore_parts < <(python3 - "$tmp/restore-connection.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
for k in ("user","password","host","port","database"): print(x[k])
PY
)
restore_user=${restore_parts[0]}; restore_password=${restore_parts[1]}; restore_host=${restore_parts[2]}; restore_port=${restore_parts[3]}
safe_restore_url="postgresql://$restore_user@$restore_host:$restore_port/$db_name"
export PGPASSWORD="$restore_password"
unset restore_password RESTORE_DB_URL RESTORE_DB_NAME PGHOST PGPORT PGUSER PGDATABASE PGOPTIONS PGSSLMODE PGSSLROOTCERT PGPASSFILE PGSERVICE PGSERVICEFILE
empty_check=$(psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$safe_restore_url" --command "SELECT (to_regclass('auth.users') IS NOT NULL)::int || ',' || (SELECT count(*) FROM auth.users)::text" 2>/dev/null) || fail 'cannot verify initialized local Supabase Auth schema'
[[ "$empty_check" == '1,0' ]] || fail 'target must have initialized Auth schema with zero users'
app_objects=$(psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$safe_restore_url" --command "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','hr_private') AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%'" 2>/dev/null) || fail 'cannot verify empty application schemas'
[[ "$app_objects" == 0 ]] || fail 'target application schemas are not empty'
history_exists=$(psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$safe_restore_url" --command "SELECT (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::int" 2>/dev/null) || fail 'cannot inspect migration history'
if [[ "$history_exists" == 1 ]]; then
  history_rows=$(psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$safe_restore_url" --command "SELECT count(*) FROM supabase_migrations.schema_migrations" 2>/dev/null) || fail 'cannot verify empty migration history'
else
  history_rows=0
fi
[[ "$history_rows" == 0 ]] || fail 'target migration history must be absent or empty'
# CLI's dump files contain managed data rows; its generated data SQL disables
# triggers in that session. Recreate only this project's Auth trigger hooks first.
psql --no-psqlrc --single-transaction --variable ON_ERROR_STOP=1 --file "$tmp/roles.sql" --file "$tmp/schema.sql" --file "$tmp/migration-history-schema.sql" --file "$tmp/auth-customizations.sql" --command 'SET session_replication_role = replica' --file "$tmp/data.sql" --file "$tmp/migration-history-data.sql" --dbname "$safe_restore_url" >/dev/null 2>&1 || fail 'local restore failed (details suppressed)'
unset PGPASSWORD
printf 'Restore rehearsal completed in %s. Verify application-specific rows, roles, policies, and extensions locally.\n' "$db_name"
