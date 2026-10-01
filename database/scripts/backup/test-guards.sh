#!/usr/bin/env bash
set -Eeuo pipefail
for tool in rg grep find mktemp bash python3 tar sha256sum shred; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }
done
root=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/supabase" <<'SH'
#!/bin/sh
if [ "$1" = --version ]; then printf '2.119.0\n'; exit; fi
printf '%s\n' "$*" >> "$CALL_LOG"
printf '%s' "$PGPASSWORD" >> "$ENV_LOG"
[ "$PGPASSWORD" = 's:ec\ret' ] || exit 42
case "$*" in *secret*|*'s:ec\ret'*|*'user:'*) exit 43;; esac
while [ $# -gt 0 ]; do
  if [ "$1" = --file ]; then shift; printf 'synthetic sql\n' > "$1"; fi
  shift
done
SH
cat > "$tmp/age" <<'SH'
#!/bin/sh
if [ "$1" = --version ]; then printf 'age 1.2.0\n'; exit; fi
while [ $# -gt 0 ]; do if [ "$1" = --output ]; then shift; out=$1; fi; shift; done
printf 'synthetic encrypted blob\n' > "$out"
SH
chmod +x "$tmp/supabase" "$tmp/age"
export PATH="$tmp:$PATH" CALL_LOG="$tmp/calls" ENV_LOG="$tmp/env" BACKUP_OUTPUT_DIR="$tmp/out" AGE_RECIPIENT=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqs
ref=abcdefghijklmnopqrst
if malformed_output=$(env SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_URL='postgresql://postgres:DO_NOT_LOG_CI_SECRET＠db.abcdefghijklmnopqrst.supabase.co:5432/postgres' bash "$root/create-encrypted-backup.sh" "$ref" 2>&1); then
  echo 'malformed credential URL accepted' >&2; exit 1
fi
[[ "$malformed_output" != *DO_NOT_LOG_CI_SECRET* ]] || { echo 'malformed URL leaked its credential' >&2; exit 1; }
if env SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_URL='postgresql://user:p@db.zyxwvutsrqponmlkjihg.supabase.co:5432/postgres' bash "$root/create-encrypted-backup.sh" "$ref" >/dev/null 2>&1; then echo 'wrong host ref accepted' >&2; exit 1; fi
if env SUPABASE_PROJECT_REF=wrong SUPABASE_DB_URL='postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres' bash "$root/create-encrypted-backup.sh" "$ref" >/dev/null 2>&1; then echo 'wrong environment ref accepted' >&2; exit 1; fi
if env SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_URL='postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres' bash "$root/create-encrypted-backup.sh" wrong >/dev/null 2>&1; then echo 'bad expected ref accepted' >&2; exit 1; fi
export SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_URL='postgresql://postgres:s%3Aec%5Cret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres'
bash "$root/create-encrypted-backup.sh" "$ref" >/dev/null
[[ $(find "$tmp/out" -maxdepth 1 -name '*.tar.age' | wc -l) -eq 1 ]]
[[ $(find "$tmp/out" -maxdepth 1 -name '*.manifest.json' | wc -l) -eq 1 ]]
! rg -q 's:ec|secret|user:' "$tmp/out" || { echo 'credential leaked to artifacts' >&2; exit 1; }
[[ $(wc -c < "$tmp/env") -eq $((5 * 8)) ]] || { echo 'expected PGPASSWORD on each dump call' >&2; exit 1; }
grep -q -- '--role-only' "$CALL_LOG"
grep -q -- '--data-only' "$CALL_LOG"
grep -q -- '--schema supabase_migrations' "$CALL_LOG"
! rg -q 'secret|s:ec|user:' "$CALL_LOG" || { echo 'credential leaked in child argv' >&2; exit 1; }
echo 'backup guard checks passed (synthetic commands only)'
