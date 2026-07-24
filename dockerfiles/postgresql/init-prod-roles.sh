#!/bin/sh

set -eu

die() {
  echo "error: $*" >&2
  exit 1
}

require_username() {
  name="$1"
  value="$2"

  case "$value" in
    '' | *[!A-Za-z0-9_]* | [0-9]* ) die "invalid PostgreSQL role name: $name" ;;
  esac

  [ "${#value}" -le 63 ] || die "PostgreSQL role name is too long: $name"
}

require_password() {
  name="$1"
  value="$2"

  [ "${#value}" -ge 32 ] || die "PostgreSQL password must contain at least 32 characters: $name"
  case "$value" in
    *'
'* ) die "PostgreSQL password must not contain a newline: $name" ;;
  esac
}

: "${APP_DATABASE_USERNAME:?APP_DATABASE_USERNAME is required}"
: "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD is required}"
: "${MIGRATION_DATABASE_USERNAME:?MIGRATION_DATABASE_USERNAME is required}"
: "${MIGRATION_DATABASE_PASSWORD:?MIGRATION_DATABASE_PASSWORD is required}"

require_username APP_DATABASE_USERNAME "$APP_DATABASE_USERNAME"
require_username MIGRATION_DATABASE_USERNAME "$MIGRATION_DATABASE_USERNAME"
require_password APP_DATABASE_PASSWORD "$APP_DATABASE_PASSWORD"
require_password MIGRATION_DATABASE_PASSWORD "$MIGRATION_DATABASE_PASSWORD"

[ "$APP_DATABASE_USERNAME" != "$MIGRATION_DATABASE_USERNAME" ] || die 'application and migration roles must differ'

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set="app_username=$APP_DATABASE_USERNAME" \
  --set="app_password=$APP_DATABASE_PASSWORD" \
  --set="migration_username=$MIGRATION_DATABASE_USERNAME" \
  --set="migration_password=$MIGRATION_DATABASE_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_username',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_username')
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'migration_username',
  :'migration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_username')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_username')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'migration_username')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_username')
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migration_username')
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_username')
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_username')
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'migration_username',
  :'app_username'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'migration_username',
  :'app_username'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE ON TYPES TO %I',
  :'migration_username',
  :'app_username'
)
\gexec
SQL
