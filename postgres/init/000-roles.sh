#!/bin/sh
set -eu

: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD nao definido}"
: "${POSTGRES_WORKER_PASSWORD:?POSTGRES_WORKER_PASSWORD nao definido}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$POSTGRES_APP_PASSWORD" \
  --set=worker_password="$POSTGRES_WORKER_PASSWORD" <<'SQL'
CREATE ROLE uptimex_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE uptimex_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE uptimex_app PASSWORD :'app_password';
ALTER ROLE uptimex_worker PASSWORD :'worker_password';
ALTER ROLE uptimex_app SET row_security = on;
ALTER ROLE uptimex_worker SET row_security = on;
SQL
