#!/usr/bin/env bash
set -Eeuo pipefail
command -v age >/dev/null 2>&1 || { echo 'age binary missing; install official age CLI to run cryptographic test' >&2; exit 2; }
command -v age-keygen >/dev/null 2>&1 || { echo 'age-keygen binary missing; install official age CLI to run cryptographic test' >&2; exit 2; }
for tool in find shred sed rg cmp sha256sum; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }; done
tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'find "$tmp" -type f -exec shred -u -- {} + 2>/dev/null || true; rm -rf -- "$tmp"' EXIT
umask 077
age-keygen -o "$tmp/identity.txt" >/dev/null 2>&1
recipient=$(sed -n 's/^# public key: //p' "$tmp/identity.txt")
[[ "$recipient" =~ ^age1[023456789acdefghjklmnpqrstuvwxyz]{30,}$ ]] || { echo 'could not read ephemeral age recipient' >&2; exit 1; }
printf 'synthetic SQL fixture only\n' > "$tmp/plaintext.sql"
age --encrypt --recipient "$recipient" --output "$tmp/fixture.age" "$tmp/plaintext.sql"
[[ -s "$tmp/fixture.age" ]]
! rg -q 'synthetic SQL fixture only' "$tmp/fixture.age" || { echo 'plaintext found in ciphertext' >&2; exit 1; }
age --decrypt --identity "$tmp/identity.txt" --output "$tmp/restored.sql" "$tmp/fixture.age"
cmp "$tmp/plaintext.sql" "$tmp/restored.sql"
sha256sum "$tmp/fixture.age" > "$tmp/ciphertext.sha256"
sha256sum --check "$tmp/ciphertext.sha256" >/dev/null
echo 'age encryption/decryption/hash roundtrip passed with ephemeral key and synthetic SQL'
