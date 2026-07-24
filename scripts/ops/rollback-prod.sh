#!/usr/bin/env bash

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$OPS_DIR/_common.sh"

usage() {
  cat <<'EOF'
Usage: rollback-prod.sh --env-file <approved-env> --app-image <image@sha256:...> \
  --edge-image <image@sha256:...> --frontend-dist <verified-directory> \
  --frontend-artifact-sha256 <sha256> --confirm-rollback [--compose-file <file>]

Rolls application processes back to immutable images. This script never runs down migrations.
EOF
}

env_file=''
app_image=''
edge_image=''
frontend_dist=''
frontend_artifact_sha256=''
compose_file="$PROJECT_ROOT/docker-compose.prod.yml"
confirmed=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) env_file="${2:-}"; shift 2 ;;
    --app-image) app_image="${2:-}"; shift 2 ;;
    --edge-image) edge_image="${2:-}"; shift 2 ;;
    --frontend-dist) frontend_dist="${2:-}"; shift 2 ;;
    --frontend-artifact-sha256) frontend_artifact_sha256="${2:-}"; shift 2 ;;
    --compose-file) compose_file="${2:-}"; shift 2 ;;
    --confirm-rollback) confirmed=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$confirmed" = true ]] || die '必须提供 --confirm-rollback'
[[ -n "$env_file" && -n "$app_image" && -n "$edge_image" && -n "$frontend_dist" && -n "$frontend_artifact_sha256" ]] || die '缺少必填参数'
[[ "$frontend_dist" = /* && -d "$frontend_dist" && -f "$frontend_dist/index.html" ]] || die '--frontend-dist 必须是包含 index.html 的绝对目录'
[[ "$frontend_artifact_sha256" =~ ^[0-9a-f]{64}$ ]] || die '--frontend-artifact-sha256 必须是小写 SHA-256'
frontend_marker="$(dirname "$frontend_dist")/artifact.sha256"
require_regular_file "$frontend_marker"
[[ "$(cat "$frontend_marker")" = "$frontend_artifact_sha256" ]] || die 'frontend artifact marker 与回滚 SHA-256 不一致'
require_docker
require_command curl
require_regular_file "$env_file"
require_regular_file "$compose_file"
require_digest_image "$app_image"
require_digest_image "$edge_image"

# Compose validates every service, including the one-shot migration service that
# rollback deliberately does not start. Reuse the app digest only to satisfy
# interpolation when no release-time migration digest is available.
compose_env=(APP_ENV_FILE="$env_file" APP_IMAGE_REF="$app_image" MIGRATION_IMAGE_REF="${MIGRATION_IMAGE_REF:-$app_image}" EDGE_IMAGE_REF="$edge_image" FRONTEND_DIST_PATH="$frontend_dist")
env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" config --quiet
env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" up -d --no-deps api agent-worker worker scheduler edge

edge_port="$(env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" port edge 8080 | sed -n '1{s/.*://p;}')"
[[ "$edge_port" =~ ^[0-9]+$ ]] || die '无法解析 edge 已发布端口'
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${edge_port}/health" >/dev/null
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${edge_port}/ready" >/dev/null

printf 'rolledBack=true\nappImage=%s\nedgeImage=%s\nfrontendDist=%s\nfrontendArtifactSha256=%s\n' "$app_image" "$edge_image" "$frontend_dist" "$frontend_artifact_sha256"
