#!/usr/bin/env bash

set -euo pipefail
umask 077

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$OPS_DIR/_common.sh"

usage() {
  cat <<'EOF'
Usage: backup-postgres.sh --env-file <approved-env> --output-dir <absolute-directory> [--compose-file <file>]

Creates an encrypted PostgreSQL custom-format backup and an integrity manifest.
BACKUP_ENCRYPTION_PASSPHRASE must come from the process environment, never the env file.
EOF
}

env_file=''
output_dir=''
compose_file="$PROJECT_ROOT/docker-compose.prod.yml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) env_file="${2:-}"; shift 2 ;;
    --output-dir) output_dir="${2:-}"; shift 2 ;;
    --compose-file) compose_file="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$output_dir" = /* ]] || die '--output-dir 必须是绝对路径'
[[ -n "$env_file" ]] || die '必须提供 --env-file'
[[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]] || die '缺少 BACKUP_ENCRYPTION_PASSPHRASE'
require_docker
require_command openssl
require_command shasum
require_regular_file "$env_file"
require_regular_file "$compose_file"
require_safe_directory "$output_dir"

postgres_user="$(compose "$env_file" "$compose_file" exec -T database sh -c 'printf %s "$POSTGRES_USER"')"
postgres_database="$(compose "$env_file" "$compose_file" exec -T database sh -c 'printf %s "$POSTGRES_DB"')"
[[ -n "$postgres_user" && -n "$postgres_database" ]] || die '无法读取运行中数据库的用户或名称'
started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
backup_file="$output_dir/postgres-${postgres_database}-${timestamp}.dump.enc"
manifest_file="$output_dir/postgres-${postgres_database}-${timestamp}.manifest.json"
lock_directory="$output_dir/.postgres-backup.lock"

if ! mkdir "$lock_directory" 2>/dev/null; then
  die "已有备份正在写入输出目录：$output_dir"
fi
temporary_file=''

cleanup() {
  [[ -z "$temporary_file" ]] || rm -f "$temporary_file"
  rmdir "$lock_directory" 2>/dev/null || true
}
trap cleanup EXIT
temporary_file="$(mktemp "$output_dir/.postgres-backup.XXXXXX")"

schema_version="$(compose "$env_file" "$compose_file" exec -T database psql -U "$postgres_user" -d "$postgres_database" -Atc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")"
[[ -n "$schema_version" ]] || die '无法读取 Prisma migration 版本'

compose "$env_file" "$compose_file" exec -T database pg_dump --format=custom --no-owner --no-privileges -U "$postgres_user" -d "$postgres_database" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE > "$temporary_file"

mv "$temporary_file" "$backup_file"
checksum="$(sha256_file "$backup_file")"
completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

require_safe_manifest_value "$postgres_database"
require_safe_manifest_value "$schema_version"
require_safe_manifest_value "$backup_file"
printf '{\n  "startedAt": "%s",\n  "completedAt": "%s",\n  "database": "%s",\n  "schemaVersion": "%s",\n  "checksum": { "algorithm": "sha256", "value": "%s" },\n  "encryptedObjectRef": "%s",\n  "encryption": { "algorithm": "aes-256-cbc-pbkdf2-sha256", "iterations": 200000 },\n  "restoreVerifiedAt": null\n}\n' \
  "$started_at" "$completed_at" "$postgres_database" "$schema_version" "$checksum" "$backup_file" > "$manifest_file"
chmod 600 "$manifest_file"

printf 'backup=%s\nmanifest=%s\nsha256=%s\nschemaVersion=%s\n' "$backup_file" "$manifest_file" "$checksum" "$schema_version"
