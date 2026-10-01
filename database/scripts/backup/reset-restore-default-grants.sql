-- Run only inside the restore helper's single transaction, before application
-- schema objects are loaded into an empty, dedicated hr_restore_* database.
-- The caller must first pass the restore helper's loopback/exact-database guard.
-- This removes target-stack postgres defaults that otherwise broaden new
-- objects. The source schema dump later reapplies its own explicit defaults.
-- Existing object ACLs, PUBLIC defaults, and postgres's own default grants are
-- intentionally untouched.
DO $reset_defaults$
DECLARE
  postgres_oid oid;
  entry record;
  object_class text;
  schema_clause text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'default privilege reset must run as postgres';
  END IF;
  IF pg_catalog.current_database() !~ '^hr_restore_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'default privilege reset requires a dedicated hr_restore_* database';
  END IF;

  IF pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'default privilege reset requires an initialized local Auth schema';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'default privilege reset requires an empty local Auth user table';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'hr_private')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND c.relname NOT LIKE 'pg_%'
  ) THEN
    RAISE EXCEPTION 'default privilege reset requires empty application schemas';
  END IF;

  SELECT r.oid INTO postgres_oid
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'postgres';
  IF postgres_oid IS NULL THEN
    RAISE EXCEPTION 'default privilege reset requires the postgres creator role';
  END IF;

  FOR entry IN
    SELECT DISTINCT
      d.defaclobjtype AS objtype,
      d.defaclnamespace AS nspoid,
      n.nspname AS schema_name,
      grantee.rolname AS grantee_name
    FROM pg_catalog.pg_default_acl AS d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
    JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
    WHERE d.defaclrole = postgres_oid
      AND (d.defaclnamespace = 0 OR n.nspname IN ('public', 'hr_private'))
      AND acl.grantee <> postgres_oid
      AND acl.grantee <> 0
    ORDER BY 1, 2, 4
  LOOP
    object_class := CASE entry.objtype
      WHEN 'r' THEN 'TABLES'
      WHEN 'S' THEN 'SEQUENCES'
      WHEN 'f' THEN 'FUNCTIONS'
      WHEN 'T' THEN 'TYPES'
      WHEN 'n' THEN 'SCHEMAS'
      ELSE NULL
    END;
    IF object_class IS NULL THEN
      RAISE EXCEPTION 'unexpected postgres default ACL object type: %', entry.objtype;
    END IF;

    IF entry.objtype = 'n' AND entry.nspoid <> 0 THEN
      RAISE EXCEPTION 'schema default ACL unexpectedly has a per-schema namespace';
    END IF;
    IF entry.nspoid <> 0 AND entry.schema_name IS NULL THEN
      RAISE EXCEPTION 'postgres default ACL references a missing namespace';
    END IF;
    schema_clause := CASE
      WHEN entry.nspoid = 0 THEN ''
      ELSE pg_catalog.format('IN SCHEMA %I ', entry.schema_name)
    END;

    EXECUTE pg_catalog.format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I %sREVOKE ALL ON %s FROM %I',
      'postgres', schema_clause, object_class, entry.grantee_name
    );
  END LOOP;
END;
$reset_defaults$;
