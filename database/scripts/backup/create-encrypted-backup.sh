#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'backup preparation failed: %s\n' "$1" >&2; exit 2; }

[[ $# -eq 1 ]] || fail 'usage: SUPABASE_PROJECT_REF=... SUPABASE_DB_URL=... AGE_RECIPIENT=... ./create-encrypted-backup.sh EXPECTED_PROJECT_REF'
expected_ref=$1
[[ "$expected_ref" =~ ^[a-z0-9]{20}$ ]] || fail 'expected project ref must be 20 lowercase letters/digits'
[[ "${SUPABASE_PROJECT_REF:-}" == "$expected_ref" ]] || fail 'project ref confirmation missing or does not match'
[[ "${SUPABASE_DB_URL:-}" =~ ^postgres(ql)?:// ]] || fail 'SUPABASE_DB_URL must be supplied through the environment'
[[ "${AGE_RECIPIENT:-}" =~ ^age1[023456789acdefghjklmnpqrstuvwxyz]{30,}$ ]] || fail 'AGE_RECIPIENT must be a valid age public recipient'
for tool in supabase age sha256sum date mktemp python3 tar find shred cut; do command -v "$tool" >/dev/null 2>&1 || fail "required tool unavailable: $tool"; done

# Always use the locally installed binary; don't allow an implicit latest-version download.
supabase_version=$(supabase --version 2>/dev/null) || fail 'cannot read Supabase CLI version'
[[ "$supabase_version" == "2.119.0" ]] || fail 'this reviewed workflow requires Supabase CLI 2.119.0; inspect source and update the tested pin before changing'
age_version=$(age --version 2>/dev/null) || fail 'cannot read age version'
[[ -n "$age_version" ]] || fail 'cannot read age version'

out_dir=${BACKUP_OUTPUT_DIR:-"$PWD/private-backups"}
[[ ! -L "$out_dir" ]] || fail 'output path must not be a symlink'
mkdir -p -- "$out_dir" || fail 'cannot create output directory'
[[ -d "$out_dir" && ! -L "$out_dir" ]] || fail 'output path must be a real directory, not a symlink'
chmod 700 -- "$out_dir" || fail 'cannot secure output directory'
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$out_dir/supabase-db-$expected_ref-$stamp.tar.age"
[[ ! -e "$archive" ]] || fail 'backup filename already exists'
tmp=$(mktemp -d "${TMPDIR:-/tmp}/sb-backup.XXXXXXXX") || fail 'cannot create private temporary directory'
chmod 700 -- "$tmp" || fail 'cannot secure temporary directory'
cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n ${tmp:-} && -d $tmp ]]; then
    if ! find "$tmp" -type f -exec shred -u -- {} + 2>/dev/null || ! rmdir "$tmp" 2>/dev/null; then
      printf 'backup cleanup failed; private temporary files may remain in %s\n' "$tmp" >&2
      rc=2
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Parse with Python's URL parser so percent-encoded credentials are decoded
# exactly once. CLI v2.119.0's db-url resolver supports ambient PGPASSWORD,
# then passes the connection password to its Docker pg_dump container as env.
python3 > "$tmp/connection.json" <<'PY' || fail 'database URL is malformed or missing username/password/host/port/database'
import json, os, sys
from urllib.parse import unquote, urlsplit
u = urlsplit(os.environ["SUPABASE_DB_URL"])
if u.scheme not in ("postgres", "postgresql") or not u.hostname or not u.port or not u.username or u.password is None or not u.path or u.path == "/" or u.query or u.fragment: raise SystemExit(1)
values = [u.username, unquote(u.password), u.hostname, str(u.port), u.path[1:]]
if any("\n" in x or "\r" in x for x in values): raise SystemExit(1)
json.dump(dict(zip(("user", "password", "host", "port", "database"), values)), sys.stdout)
PY
mapfile -t dbparts < <(python3 - "$tmp/connection.json" <<'PY'
import json, sys
x=json.load(open(sys.argv[1], encoding="utf-8"))
for k in ("user","password","host","port","database"): print(x[k])
PY
)
db_user=${dbparts[0]}; db_password=${dbparts[1]}; db_host=${dbparts[2]}; db_port=${dbparts[3]}; db_name=${dbparts[4]}
[[ "$db_user" =~ ^[A-Za-z0-9_.-]+$ && "$db_host" =~ ^[A-Za-z0-9.-]+$ && "$db_name" == postgres && "$db_port" == 5432 ]] || fail 'only the Supabase postgres database on supported port 5432 is accepted'
if [[ "$db_host" == db.*.supabase.co ]]; then
  [[ "$db_user" == postgres ]] || fail 'direct Supabase database endpoint must use the postgres role'
  ref=${db_host#db.}; ref=${ref%.supabase.co}
elif [[ "$db_host" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ && "$db_user" =~ ^postgres\.([a-z0-9]{20})$ ]]; then
  ref=${BASH_REMATCH[1]}
else
  fail 'connection host/user does not prove a supported Supabase project target'
fi
[[ "$ref" == "$expected_ref" ]] || fail 'connection host/user project reference does not match expected project'
safe_db_url="postgresql://$db_user@$db_host:$db_port/$db_name"
export PGPASSWORD="$db_password"
unset db_password SUPABASE_DB_URL
unset PGHOST PGPORT PGUSER PGDATABASE PGOPTIONS PGSSLMODE PGSSLROOTCERT PGPASSFILE PGSERVICE PGSERVICEFILE
supabase db dump --db-url "$safe_db_url" --file "$tmp/roles.sql" --role-only >/dev/null 2>&1 || fail 'roles dump failed (details suppressed)'
supabase db dump --db-url "$safe_db_url" --file "$tmp/schema.sql" >/dev/null 2>&1 || fail 'schema dump failed (details suppressed)'
supabase db dump --db-url "$safe_db_url" --file "$tmp/data.sql" --data-only --use-copy --exclude storage.buckets_vectors --exclude storage.vector_indexes >/dev/null 2>&1 || fail 'data dump failed (details suppressed)'
supabase db dump --db-url "$safe_db_url" --schema supabase_migrations --file "$tmp/migration-history-schema.sql" >/dev/null 2>&1 || fail 'migration history schema dump failed (details suppressed)'
supabase db dump --db-url "$safe_db_url" --schema supabase_migrations --data-only --use-copy --file "$tmp/migration-history-data.sql" >/dev/null 2>&1 || fail 'migration history data dump failed (details suppressed)'
unset PGPASSWORD

# The regular schema dump excludes `auth`; preserve this project's custom Auth
# triggers as a reviewed, explicit component rather than pretending they are included.
cat > "$tmp/auth-customizations.sql" <<'SQL'
DROP TRIGGER IF EXISTS hr_authorized_account_created ON auth.users;
CREATE TRIGGER hr_authorized_account_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION hr_private.sync_authorized_account();
DROP TRIGGER IF EXISTS hr_authorized_account_changed ON auth.users;
CREATE TRIGGER hr_authorized_account_changed AFTER UPDATE OF email, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION hr_private.sync_authorized_account();
SQL
cp database/hr_accounts.sql "$tmp/hr_accounts_source.sql"
source_digest=$(sha256sum database/hr_accounts.sql | cut -d' ' -f1)
auth_component_digest=$(sha256sum "$tmp/auth-customizations.sql" | cut -d' ' -f1)

for f in roles.sql schema.sql data.sql; do [[ -s "$tmp/$f" ]] || fail "empty dump output: $f"; done
tar -C "$tmp" -cf "$tmp/backup.tar" roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql auth-customizations.sql || fail 'archive creation failed'
age --encrypt --recipient "$AGE_RECIPIENT" --output "$archive" "$tmp/backup.tar" 2>/dev/null || fail 'encryption failed'
[[ -s "$archive" ]] || fail 'encrypted output is empty'
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)
digest=$(sha256sum "$archive" | cut -d' ' -f1)
manifest="$archive.manifest.json"
python3 - "$manifest" "$expected_ref" "$started" "$finished" "$supabase_version" "$age_version" "$digest" "$source_digest" "$auth_component_digest" <<'PY'
import json, os, sys
path, ref, start, end, cli, age, digest, source_digest, auth_component_digest = sys.argv[1:]
with open(path, "x", encoding="utf-8") as f:
    json.dump({"format":"supabase-db-logical-backup-v1", "project_ref":ref,
              "started_utc":start, "finished_utc":end, "supabase_cli":cli,
              "age":age, "encrypted_sha256":digest,
              "components":["roles.sql","schema.sql","data.sql","migration-history-schema.sql","migration-history-data.sql","auth-customizations.sql"],
              "auth_customization_source_sha256":source_digest,
              "component_sha256":{"auth-customizations.sql":auth_component_digest},
              "scope":"database logical dump with Supabase-managed Auth/Storage schemas omitted from schema; data dump contains included data schemas except CLI-managed exclusions; Storage object bytes excluded"}, f, sort_keys=True)
    f.write("\n")
os.chmod(path, 0o600)
PY
printf 'Encrypted backup created: %s\nManifest: %s\nSHA-256: %s\n' "$archive" "$manifest" "$digest"
