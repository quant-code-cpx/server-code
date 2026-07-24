#!/usr/bin/env bash

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$OPS_DIR/_common.sh"

usage() {
  cat <<'EOF'
Usage: verify-postgres-backup.sh --env-file <approved-env> --manifest <backup-manifest> [--compose-file <file>]

Checks encrypted backup checksum and verifies the decrypted PostgreSQL archive index.
BACKUP_ENCRYPTION_PASSPHRASE must come from the process environment.
EOF
}

env_file=''
manifest_file=''
compose_file="$PROJECT_ROOT/docker-compose.prod.yml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) env_file="${2:-}"; shift 2 ;;
    --manifest) manifest_file="${2:-}"; shift 2 ;;
    --compose-file) compose_file="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ -n "$env_file" ]] || die '必须提供 --env-file'
[[ -n "$manifest_file" ]] || die '必须提供 --manifest'
[[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]] || die '缺少 BACKUP_ENCRYPTION_PASSPHRASE'
require_docker
require_command openssl
require_command shasum
require_regular_file "$env_file"
require_regular_file "$compose_file"
require_regular_file "$manifest_file"

backup_file="$(manifest_value "$manifest_file" encryptedObjectRef)"
expected_checksum="$(manifest_checksum "$manifest_file")"
require_regular_file "$backup_file"

actual_checksum="$(sha256_file "$backup_file")"
[[ "$actual_checksum" = "$expected_checksum" ]] || die '备份 SHA-256 校验失败'

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$backup_file" \
  | compose "$env_file" "$compose_file" exec -T database pg_restore --list >/dev/null

printf 'verified=true\nmanifest=%s\nsha256=%s\n' "$manifest_file" "$actual_checksum"
