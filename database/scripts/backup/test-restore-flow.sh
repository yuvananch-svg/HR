#!/usr/bin/env bash
set -Eeuo pipefail
for tool in age age-keygen python3 tar sha256sum shred find sed rg cmp; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool missing; install age/core utilities to run restore orchestration test" >&2; exit 2; }; done
script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$script_dir/../../.." && pwd)
tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'find "$tmp" -type f -exec shred -u -- {} + 2>/dev/null || true; rm -rf -- "$tmp"' EXIT
umask 077

cat > "$tmp/psql" <<'SH'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == --version ]]; then echo 'psql (PostgreSQL) 17.6'; exit 0; fi
[[ "${PGPASSWORD:-}" == 'local:pass\word' ]] || exit 41
case "$*" in
  *"SELECT (to_regclass('auth.users') IS NOT NULL)"*) echo '1,0' ;;
  *"SELECT count(*) FROM pg_class"*) echo "${APP_OBJECTS:-0}" ;;
  *"SELECT (to_regclass('supabase_migrations.schema_migrations')"*) echo "${HISTORY_EXISTS:-1}" ;;
  *"SELECT count(*) FROM supabase_migrations.schema_migrations"*) echo 0 ;;
  *--file*) printf '%s\n' "$*" >> "$PSQL_RESTORE_LOG" ;;
  *) exit 42 ;;
esac
case "$*" in *'local:pass\word'*|*'postgres:'*) exit 43;; esac
SH
chmod +x "$tmp/psql"
export PATH="$tmp:$PATH" PSQL_RESTORE_LOG="$tmp/restore.log" AGE_IDENTITY_FILE="$tmp/identity.txt"
age-keygen -o "$AGE_IDENTITY_FILE" >/dev/null 2>&1
recipient=$(sed -n 's/^# public key: //p' "$AGE_IDENTITY_FILE")
ref=abcdefghijklmnopqrst
mkdir "$tmp/good"
for f in roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql; do printf 'synthetic %s\n' "$f" > "$tmp/good/$f"; done
printf 'DROP TRIGGER IF EXISTS synthetic;\n' > "$tmp/good/auth-customizations.sql"

make_backup() {
  local dir=$1 name=$2
  local names=(roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql auth-customizations.sql)
  tar -C "$dir" -cf "$tmp/$name.tar" "${names[@]}"
  age --encrypt --recipient "$recipient" --output "$tmp/supabase-db-$ref-$name.tar.age" "$tmp/$name.tar"
  python3 - "$tmp/supabase-db-$ref-$name.tar.age" "$tmp/supabase-db-$ref-$name.tar.age.manifest.json" "$repo_root/database/hr_accounts.sql" "$dir/auth-customizations.sql" "$ref" <<'PY'
import hashlib, json, os, sys
blob, manifest, source, custom, ref = sys.argv[1:]
m={"format":"supabase-db-logical-backup-v1","project_ref":ref,
"encrypted_sha256":hashlib.sha256(open(blob,"rb").read()).hexdigest(),
"auth_customization_source_sha256":hashlib.sha256(open(source,"rb").read()).hexdigest(),
"component_sha256":{"auth-customizations.sql":hashlib.sha256(open(custom,"rb").read()).hexdigest()},
"components":["roles.sql","schema.sql","data.sql","migration-history-schema.sql","migration-history-data.sql","auth-customizations.sql"]}
json.dump(m,open(manifest,"x",encoding="utf-8"),sort_keys=True)
PY
}

make_backup "$tmp/good" good
archive="$tmp/supabase-db-$ref-good.tar.age"
manifest="$archive.manifest.json"
export RESTORE_DB_URL='postgresql://postgres:local%3Apass%5Cword@127.0.0.1:54322/hr_restore_synthetic'
bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic >/dev/null
grep -q -- '--file' "$PSQL_RESTORE_LOG" || { echo 'successful synthetic flow did not reach restore files' >&2; exit 1; }
! rg -q 'local:pass|postgres:' "$PSQL_RESTORE_LOG" || { echo 'restore credential leaked to psql argv' >&2; exit 1; }
restore_lines=$(wc -l < "$PSQL_RESTORE_LOG")
assert_refusal_no_restore() {
  local label=$1
  [[ $(wc -l < "$PSQL_RESTORE_LOG") -eq $restore_lines ]] || { echo "$label reached restore execution" >&2; exit 1; }
}

if RESTORE_DB_URL='postgresql://postgres:pw@remote.example:5432/hr_restore_synthetic' bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic >/dev/null 2>&1; then echo 'remote target accepted' >&2; exit 1; fi
assert_refusal_no_restore 'remote target'
if RESTORE_DB_URL='postgresql://postgres:pw@127.0.0.1:54322/hr_restore_synthetic?sslmode=require' bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic >/dev/null 2>&1; then echo 'query override accepted' >&2; exit 1; fi
assert_refusal_no_restore 'query override'
if RESTORE_DB_URL='postgresql://postgres:pw@127.0.0.1:54322/hr_restore_synthetic#fragment' bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic >/dev/null 2>&1; then echo 'URL fragment accepted' >&2; exit 1; fi
assert_refusal_no_restore 'URL fragment'
if malformed_output=$(RESTORE_DB_URL='postgresql://postgres:DO_NOT_LOG_CI_SECRET＠127.0.0.1:54322/hr_restore_synthetic' bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic 2>&1); then
  echo 'malformed credential URL accepted' >&2; exit 1
fi
[[ "$malformed_output" != *DO_NOT_LOG_CI_SECRET* ]] || { echo 'malformed restore URL leaked its credential' >&2; exit 1; }
assert_refusal_no_restore 'malformed credential URL'
if APP_OBJECTS=1 bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic >/dev/null 2>&1; then echo 'nonempty app target accepted' >&2; exit 1; fi
assert_refusal_no_restore 'nonempty target'

cp "$archive" "$tmp/tampered.tar.age"
printf 'tampered' >> "$tmp/tampered.tar.age"
if bash "$script_dir/restore-local-encrypted-backup.sh" "$tmp/tampered.tar.age" "$manifest" hr_restore_synthetic >/dev/null 2>&1; then echo 'ciphertext mismatch accepted' >&2; exit 1; fi
assert_refusal_no_restore 'ciphertext mismatch'

mkdir "$tmp/hostile"
for f in roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql auth-customizations.sql; do printf 'synthetic\n' > "$tmp/hostile/$f"; done
make_backup "$tmp/hostile" hostile
hostile="$tmp/supabase-db-$ref-hostile.tar.age"
python3 - "$tmp/hostile.tar" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1],"a") as t:
 info=tarfile.TarInfo("../escape.sql"); data=b"synthetic\n"; info.size=len(data); t.addfile(info,__import__("io").BytesIO(data))
PY
age --encrypt --recipient "$recipient" --output "$tmp/supabase-db-$ref-hostile.tar.age" "$tmp/hostile.tar"
python3 - "$hostile" "$tmp/supabase-db-$ref-hostile.tar.age.manifest.json" <<'PY'
import hashlib,json,sys
blob,mf=sys.argv[1:]; m=json.load(open(mf)); m["encrypted_sha256"]=hashlib.sha256(open(blob,"rb").read()).hexdigest(); json.dump(m,open(mf,"w"),sort_keys=True)
PY
if bash "$script_dir/restore-local-encrypted-backup.sh" "$hostile" "$tmp/supabase-db-$ref-hostile.tar.age.manifest.json" hr_restore_synthetic >/dev/null 2>&1; then echo 'hostile tar accepted' >&2; exit 1; fi
assert_refusal_no_restore 'hostile archive'
HISTORY_EXISTS=0 bash "$script_dir/restore-local-encrypted-backup.sh" "$archive" "$manifest" hr_restore_synthetic >/dev/null
echo 'restore orchestration checks passed with real age encryption and stubbed psql only'
