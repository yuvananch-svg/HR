#!/usr/bin/env bash
# CI-only synthetic drill. Uses the existing ephemeral service's internal socket;
# no URL, password, or external host is accepted by this script.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true || { echo 'This drill runs only in isolated GitHub Actions'; exit 1; }
test "$#" -eq 1 && [[ "$1" =~ ^[a-f0-9]{64}$ ]] || { echo 'Expected service container ID'; exit 1; }
container_id="$1"
test "$(docker inspect --format '{{.Config.Image}}' "$container_id")" = postgres:17
pg() { docker exec -i "$container_id" env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"; }
sql() { pg psql -X -v ON_ERROR_STOP=1 -U regression_runner -d "$1"; }
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
started=$SECONDS
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
sql hr_regression_test < database/tests/local-regression/verify-baseline.sql
# Fail if a restore database already exists; never overwrite a target.
pg createdb -U regression_runner --template=template0 hr_regression_restore_test
sql hr_regression_test < database/tests/restore-rehearsal/seed.sql
sql hr_regression_test < database/tests/restore-rehearsal/verify.sql
pg psql -X -qAt -v ON_ERROR_STOP=1 -U regression_runner -d hr_regression_test < database/tests/restore-rehearsal/fingerprint.sql > "$work_dir/source.txt"
pg pg_dump -U regression_runner --format=custom --no-owner --dbname=hr_regression_test > "$work_dir/synthetic.dump"
test -s "$work_dir/synthetic.dump"
# Preserve ACLs. Roles already exist globally in this ephemeral PostgreSQL cluster.
pg pg_restore -U regression_runner --exit-on-error --no-owner --dbname=hr_regression_restore_test < "$work_dir/synthetic.dump"
pg psql -X -qAt -v ON_ERROR_STOP=1 -U regression_runner -d hr_regression_restore_test < database/tests/restore-rehearsal/fingerprint.sql > "$work_dir/restored.txt"
diff -u "$work_dir/source.txt" "$work_dir/restored.txt"
sql hr_regression_restore_test < database/tests/restore-rehearsal/verify.sql
sql hr_regression_restore_test < database/tests/restore-rehearsal/cleanup.sql
sql hr_regression_restore_test < database/tests/local-regression/verify-baseline.sql
HR_TEST_DATABASE_URL=postgresql://regression_runner:regression_runner_local_only@127.0.0.1:54322/hr_regression_restore_test node database/scripts/local-regression.mjs regressions --restore-target
sql hr_regression_test < database/tests/restore-rehearsal/cleanup.sql
sql hr_regression_test < database/tests/local-regression/verify-baseline.sql
echo "PASS: synthetic pg_dump/pg_restore; graph/security checksums match; restored regressions and both baseline cleanups passed (${SECONDS}s since shell start; $((SECONDS-started))s drill)."
