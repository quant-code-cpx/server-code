#!/usr/bin/env bash

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$OPS_DIR/_common.sh"

usage() {
  cat <<'EOF'
Usage: rollout-prod.sh --env-file <approved-env> --app-image <image@sha256:...> \
  --edge-image <image@sha256:...> --frontend-dist <verified-directory> \
  --frontend-artifact-sha256 <sha256> --client-commit <sha> \
  --client-e2e-run-id <run-id> --server-release-run-id <run-id> \
  --manifest-dir <absolute-directory> --confirm-rollout \
  [--migration-image <image@sha256:...>] [--compose-file <file>] \
  [--canary-prometheus-url <http(s)://...>] [--canary-window <duration>] \
  [--canary-baseline-file <evidence.json>]

Runs migration before application release. All image references must be immutable digests.
When a Prometheus URL is supplied, a failed canary metrics gate rolls app and edge
back to the prior release manifest without applying a down migration.
EOF
}

env_file=''
app_image=''
edge_image=''
migration_image=''
frontend_dist=''
frontend_artifact_sha256=''
client_commit=''
client_e2e_run_id=''
server_release_run_id=''
manifest_dir=''
compose_file="$PROJECT_ROOT/docker-compose.prod.yml"
canary_prometheus_url=''
canary_window='10m'
canary_baseline_file=''
confirmed=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) env_file="${2:-}"; shift 2 ;;
    --app-image) app_image="${2:-}"; shift 2 ;;
    --edge-image) edge_image="${2:-}"; shift 2 ;;
    --migration-image) migration_image="${2:-}"; shift 2 ;;
    --frontend-dist) frontend_dist="${2:-}"; shift 2 ;;
    --frontend-artifact-sha256) frontend_artifact_sha256="${2:-}"; shift 2 ;;
    --client-commit) client_commit="${2:-}"; shift 2 ;;
    --client-e2e-run-id) client_e2e_run_id="${2:-}"; shift 2 ;;
    --server-release-run-id) server_release_run_id="${2:-}"; shift 2 ;;
    --manifest-dir) manifest_dir="${2:-}"; shift 2 ;;
    --compose-file) compose_file="${2:-}"; shift 2 ;;
    --canary-prometheus-url) canary_prometheus_url="${2:-}"; shift 2 ;;
    --canary-window) canary_window="${2:-}"; shift 2 ;;
    --canary-baseline-file) canary_baseline_file="${2:-}"; shift 2 ;;
    --confirm-rollout) confirmed=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$confirmed" = true ]] || die '必须提供 --confirm-rollout'
[[ -n "$env_file" && -n "$app_image" && -n "$edge_image" && -n "$frontend_dist" && -n "$frontend_artifact_sha256" && -n "$client_commit" && -n "$client_e2e_run_id" && -n "$server_release_run_id" && -n "$manifest_dir" ]] || die '缺少必填参数'
[[ "$manifest_dir" = /* ]] || die '--manifest-dir 必须是绝对路径'
[[ "$frontend_dist" = /* && -d "$frontend_dist" && -f "$frontend_dist/index.html" ]] || die '--frontend-dist 必须是包含 index.html 的绝对目录'
[[ "$frontend_artifact_sha256" =~ ^[0-9a-f]{64}$ ]] || die '--frontend-artifact-sha256 必须是小写 SHA-256'
[[ "$client_commit" =~ ^[0-9a-f]{40}$ ]] || die '--client-commit 必须是 40 位小写 commit SHA'
[[ "$client_e2e_run_id" =~ ^[1-9][0-9]*$ ]] || die '--client-e2e-run-id 必须是正整数'
[[ "$server_release_run_id" =~ ^[1-9][0-9]*$ ]] || die '--server-release-run-id 必须是正整数'
frontend_marker="$(dirname "$frontend_dist")/artifact.sha256"
require_regular_file "$frontend_marker"
[[ "$(cat "$frontend_marker")" = "$frontend_artifact_sha256" ]] || die 'frontend artifact marker 与发布 SHA-256 不一致'
require_docker
require_command curl
require_regular_file "$env_file"
require_regular_file "$compose_file"
require_safe_directory "$manifest_dir"
require_digest_image "$app_image"
require_digest_image "$edge_image"
migration_image="${migration_image:-$app_image}"
require_digest_image "$migration_image"

previous_manifest="$(find "$manifest_dir" -maxdepth 1 -type f -name 'release-*.json' -print | sort | tail -n 1)"
previous_app_image=''
previous_edge_image=''
previous_frontend_dist=''
previous_frontend_artifact_sha256=''
if [[ -n "$previous_manifest" ]]; then
  previous_app_image="$(manifest_value "$previous_manifest" serverImageDigest)"
  previous_edge_image="$(manifest_value "$previous_manifest" edgeImageDigest)"
  previous_frontend_dist="$(manifest_value "$previous_manifest" frontendDistPath)"
  previous_frontend_artifact_sha256="$(manifest_value "$previous_manifest" frontendArtifactSha256)"
  require_digest_image "$previous_app_image"
  require_digest_image "$previous_edge_image"
  [[ "$previous_frontend_dist" = /* && -d "$previous_frontend_dist" && -f "$previous_frontend_dist/index.html" ]] || die '上一版本 frontendDistPath 无效'
  [[ "$previous_frontend_artifact_sha256" =~ ^[0-9a-f]{64}$ ]] || die '上一版本 frontendArtifactSha256 无效'
  previous_frontend_marker="$(dirname "$previous_frontend_dist")/artifact.sha256"
  require_regular_file "$previous_frontend_marker"
  [[ "$(cat "$previous_frontend_marker")" = "$previous_frontend_artifact_sha256" ]] || die '上一版本 frontend artifact marker 不匹配'
fi

if [[ -n "$canary_prometheus_url" ]]; then
  [[ "$canary_prometheus_url" =~ ^https?://[^[:space:]]+$ ]] || die '--canary-prometheus-url 必须是 http(s) URL'
  [[ "$canary_window" =~ ^[1-9][0-9]*[smhdwy]$ ]] || die '--canary-window 必须是 Prometheus duration，例如 10m'
  [[ -n "$previous_app_image" && -n "$previous_edge_image" && -n "$previous_frontend_dist" ]] || die 'canary 发布需要 manifest-dir 中已有上一版本完整 release manifest'
  if [[ -n "$canary_baseline_file" ]]; then
    require_regular_file "$canary_baseline_file"
  fi
fi

compose_env=(APP_ENV_FILE="$env_file" APP_IMAGE_REF="$app_image" MIGRATION_IMAGE_REF="$migration_image" EDGE_IMAGE_REF="$edge_image" FRONTEND_DIST_PATH="$frontend_dist")
env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" config --quiet
env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" up -d database redis
env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" run --rm migration
env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" up -d --no-deps api agent-worker worker scheduler edge

edge_port="$(env "${compose_env[@]}" "$DOCKER_BIN" compose --env-file "$env_file" -f "$compose_file" port edge 8080 | sed -n '1{s/.*://p;}')"
[[ "$edge_port" =~ ^[0-9]+$ ]] || die '无法解析 edge 已发布端口'
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${edge_port}/health" >/dev/null
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${edge_port}/ready" >/dev/null

canary_evidence=''
if [[ -n "$canary_prometheus_url" ]]; then
  canary_args=(
    --prometheus-url "$canary_prometheus_url"
    --evidence-dir "$manifest_dir"
    --window "$canary_window"
  )
  if [[ -n "$canary_baseline_file" ]]; then
    canary_args+=(--baseline-file "$canary_baseline_file")
  fi

  if ! canary_output="$(bash "$OPS_DIR/check-canary-metrics.sh" "${canary_args[@]}")"; then
    printf '%s\n' "$canary_output" >&2
    printf 'canary failed; restoring prior immutable app and edge images\n' >&2
    bash "$OPS_DIR/rollback-prod.sh" \
      --env-file "$env_file" \
      --app-image "$previous_app_image" \
      --edge-image "$previous_edge_image" \
      --frontend-dist "$previous_frontend_dist" \
      --frontend-artifact-sha256 "$previous_frontend_artifact_sha256" \
      --compose-file "$compose_file" \
      --confirm-rollback
    die 'canary metrics gate failed; prior release restored'
  fi
  canary_evidence="$(printf '%s\n' "$canary_output" | sed -n 's/^evidence=//p')"
  require_regular_file "$canary_evidence"
fi

released_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
manifest_file="$manifest_dir/release-${released_at//[:]/}.json"
require_safe_manifest_value "$app_image"
require_safe_manifest_value "$edge_image"
require_safe_manifest_value "$frontend_dist"
require_safe_manifest_value "$frontend_artifact_sha256"
require_safe_manifest_value "$client_commit"
require_safe_manifest_value "$client_e2e_run_id"
require_safe_manifest_value "$server_release_run_id"
require_safe_manifest_value "$previous_app_image"
require_safe_manifest_value "$previous_frontend_dist"
canary_evidence_file=''
if [[ -n "$canary_evidence" ]]; then
  canary_evidence_file="$(basename "$canary_evidence")"
fi
printf '{\n  "releasedAt": "%s",\n  "serverReleaseRunId": "%s",\n  "serverImageDigest": "%s",\n  "migrationImageDigest": "%s",\n  "edgeImageDigest": "%s",\n  "frontendDistPath": "%s",\n  "frontendArtifactSha256": "%s",\n  "clientCommit": "%s",\n  "clientE2ERunId": "%s",\n  "previousServerImageDigest": "%s",\n  "previousFrontendDistPath": "%s",\n  "canaryEvidence": "%s",\n  "health": "ok",\n  "readiness": "ok"\n}\n' \
  "$released_at" "$server_release_run_id" "$app_image" "$migration_image" "$edge_image" "$frontend_dist" "$frontend_artifact_sha256" "$client_commit" "$client_e2e_run_id" "$previous_app_image" "$previous_frontend_dist" "$canary_evidence_file" > "$manifest_file"
chmod 600 "$manifest_file"

printf 'released=true\nmanifest=%s\n' "$manifest_file"
