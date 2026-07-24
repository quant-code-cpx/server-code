#!/usr/bin/env bash

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$OPS_DIR/_common.sh"

usage() {
  cat <<'EOF'
Usage: restore-postgres-drill.sh --env-file <approved-env> --manifest <backup-manifest> \
  --target-container <isolated-postgres-container> --target-user <user> --target-database <database> \
  --smoke-url <isolated-api-url> --confirm-isolated-restore [--compose-file <file>]

Restores only into an empty, isolated PostgreSQL container. It refuses the source database container.
BACKUP_ENCRYPTION_PASSPHRASE must come from the process environment.
EOF
}

env_file=''
manifest_file=''
target_container=''
target_user=''
target_database=''
smoke_url=''
confirmed=false
compose_file="$PROJECT_ROOT/docker-compose.prod.yml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) env_file="${2:-}"; shift 2 ;;
    --manifest) manifest_file="${2:-}"; shift 2 ;;
    --target-container) target_container="${2:-}"; shift 2 ;;
    --target-user) target_user="${2:-}"; shift 2 ;;
    --target-database) target_database="${2:-}"; shift 2 ;;
    --smoke-url) smoke_url="${2:-}"; shift 2 ;;
    --confirm-isolated-restore) confirmed=true; shift ;;
    --compose-file) compose_file="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$confirmed" = true ]] || die '必须提供 --confirm-isolated-restore'
[[ -n "$env_file" && -n "$manifest_file" ]] || die '必须提供 --env-file 和 --manifest'
[[ -n "$target_container" && -n "$target_user" && -n "$target_database" ]] || die '必须提供隔离数据库目标参数'
[[ "$smoke_url" =~ ^https?:// ]] || die '--smoke-url 必须是 http(s) URL'
[[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]] || die '缺少 BACKUP_ENCRYPTION_PASSPHRASE'
require_docker
require_command curl
require_regular_file "$env_file"
require_regular_file "$compose_file"
require_regular_file "$manifest_file"

"$OPS_DIR/verify-postgres-backup.sh" --env-file "$env_file" --manifest "$manifest_file" --compose-file "$compose_file"

source_container_id="$(compose "$env_file" "$compose_file" ps -q database)"
target_container_id="$("$DOCKER_BIN" inspect --format '{{.Id}}' "$target_container" 2>/dev/null)"
[[ -n "$source_container_id" && -n "$target_container_id" ]] || die '无法识别源或目标数据库容器'
[[ "$source_container_id" != "$target_container_id" ]] || die '拒绝向源生产数据库恢复'
[[ "$("$DOCKER_BIN" inspect --format '{{.State.Running}}' "$target_container")" = true ]] || die '隔离目标容器未运行'

"$DOCKER_BIN" exec "$target_container" pg_isready -U "$target_user" -d "$target_database" >/dev/null
existing_tables="$("$DOCKER_BIN" exec "$target_container" psql -U "$target_user" -d "$target_database" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[[ "$existing_tables" = 0 ]] || die '隔离目标数据库并非空库，拒绝覆盖'
target_app_user="$("$DOCKER_BIN" exec "$target_container" sh -c 'printf %s "$APP_DATABASE_USERNAME"')"
[[ "$target_app_user" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || die '隔离目标缺少有效 APP_DATABASE_USERNAME'

backup_file="$(manifest_value "$manifest_file" encryptedObjectRef)"
schema_version="$(manifest_value "$manifest_file" schemaVersion)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$backup_file" \
  | "$DOCKER_BIN" exec -i "$target_container" pg_restore --exit-on-error --no-owner --no-privileges -U "$target_user" -d "$target_database"

restored_schema_version="$("$DOCKER_BIN" exec "$target_container" psql -U "$target_user" -d "$target_database" -Atc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")"
[[ "$restored_schema_version" = "$schema_version" ]] || die '恢复后的 Prisma migration 版本不匹配'
restored_tables="$("$DOCKER_BIN" exec "$target_container" psql -U "$target_user" -d "$target_database" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[[ "$restored_tables" -gt 0 ]] || die '恢复后未发现 public 数据表'

# pg_restore deliberately omits owner and ACL metadata. Restore grants required
# runtime access again, then prove the application role can read the schema.
"$DOCKER_BIN" exec -i "$target_container" psql --set=ON_ERROR_STOP=1 -U "$target_user" -d "$target_database" --set="app_username=$target_app_user" <<'SQL'
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_username')
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_username')
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_username')
\gexec
SQL
app_migration_count="$("$DOCKER_BIN" exec "$target_container" psql -U "$target_app_user" -d "$target_database" -Atc 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
[[ "$app_migration_count" -gt 0 ]] || die '应用数据库角色无法读取恢复后的 migration 表'

smoke_ready=false
for attempt in {1..12}; do
  if curl --fail --silent --max-time 10 "${smoke_url%/}/ready" >/dev/null; then
    smoke_ready=true
    break
  fi
  sleep 5
done
[[ "$smoke_ready" = true ]] || die '隔离应用 readiness 在 60 秒内未恢复'
verified_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
require_safe_manifest_value "$target_container"
manifest_temp="$(mktemp "${manifest_file}.XXXXXX")"
trap 'rm -f "$manifest_temp"' EXIT
awk -v verified_at="$verified_at" -v target="$target_container" '
  /"restoreVerifiedAt"[[:space:]]*:[[:space:]]*null/ {
    print "  \"restoreVerifiedAt\": \"" verified_at "\","
    print "  \"restoreTarget\": \"" target "\""
    next
  }
  { print }
' "$manifest_file" > "$manifest_temp"
mv "$manifest_temp" "$manifest_file"
chmod 600 "$manifest_file"

printf 'restored=true\ntarget=%s\nrestoredTables=%s\nrestoreVerifiedAt=%s\n' "$target_container" "$restored_tables" "$verified_at"
