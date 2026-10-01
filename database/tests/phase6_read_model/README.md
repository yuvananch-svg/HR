# Phase 6 read-model regression

Run as administrator against the migrated HR schema with `psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f database/tests/phase6_read_model.sql`. Existing active owner and HR memberships are required; their IDs are resolved inside the transaction and are never stored in the fixture file. No credentials or membership changes are made.

The script seeds isolated synthetic rows into actual application tables, checks owner/HR reads under authenticated roles, rejects anonymous/uninvited reads, and rolls back all fixtures. It verifies 1,005 entries, stable tied-timestamp pages, 1,001 distinct people, recorded-only annual usage, half days counted as one person, cancelled exclusion, cross-year historical overlap, and zero versus missing entitlement. Administrative stress fixtures exercise read semantics; they do not validate mutation RPC business rules. Phase 4–5 regression suites cover those separately.

Executed successfully against HRM on 2026-10-01. A follow-up query found zero Phase 6 fixture employees/types. SQL verifies schema/RLS/aggregation semantics; it does not by itself prove the REST response cap handling, PostgREST search parser, browser rendering or mobile layout. Application tests and browser QA must cover those separately.
