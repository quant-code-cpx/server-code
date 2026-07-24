#!/usr/bin/env bash

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$OPS_DIR/../.." && pwd -P)"
DOCKER_BIN="${DOCKER_BIN:-docker}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

require_docker() {
  command -v "$DOCKER_BIN" >/dev/null 2>&1 || die "缺少 Docker CLI：$DOCKER_BIN"
}

require_regular_file() {
  [[ -n "$1" && -f "$1" ]] || die "文件不存在或不是普通文件：${1:-<empty>}"
}

require_safe_directory() {
  local directory="$1"
  [[ -n "$directory" && "$directory" != "/" ]] || die '输出目录不能为空或根目录'
  mkdir -p "$directory"
  [[ -d "$directory" ]] || die "无法创建输出目录：$directory"
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

manifest_value() {
  local manifest="$1"
  local field="$2"
  local value

  require_regular_file "$manifest"
  value="$(sed -n "s/^[[:space:]]*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\"[[:space:]]*,\{0,1\}[[:space:]]*$/\1/p" "$manifest" | head -n 1)"
  [[ -n "$value" ]] || die "manifest 缺少 $field"
  printf '%s' "$value"
}

manifest_checksum() {
  local manifest="$1"
  local checksum

  require_regular_file "$manifest"
  checksum="$(sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F]\{64\}\)".*/\1/p' "$manifest" | head -n 1)"
  [[ "$checksum" =~ ^[0-9a-fA-F]{64}$ ]] || die 'manifest 缺少有效 SHA-256'
  printf '%s' "$checksum"
}

require_safe_manifest_value() {
  [[ "$1" != *'"'* && "$1" != *\\* && "$1" != *$'\n'* ]] || die 'manifest 字段不能包含引号、反斜杠或换行'
}

require_digest_image() {
  [[ "$1" =~ ^[^[:space:]@]+@sha256:[0-9a-fA-F]{64}$ ]] || die '镜像必须是不可变 sha256 digest 引用'
}

compose() {
  local env_file="$1"
  local compose_file="$2"
  shift 2
  "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" "$@"
}
