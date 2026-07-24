#!/usr/bin/env bash

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$OPS_DIR/_common.sh"

usage() {
  cat <<'EOF'
Usage: check-canary-metrics.sh --prometheus-url <http(s)://...> --evidence-dir <absolute-directory> \
  [--window <duration>] [--currency <code>] [--baseline-file <evidence.json>] [--capture-only] \
  [--max-http-error-rate <ratio>] [--max-http-p95-seconds <seconds>] \
  [--min-agent-run-success-rate <ratio>] [--max-agent-cost <amount>] \
  [--max-queue-depth <count>] [--max-queue-lag-p95-seconds <seconds>]

Queries production metrics and fails closed when a required signal has no data.
Use --capture-only before rollout to create a baseline. A later invocation with
--baseline-file enforces both absolute thresholds and allowed regression budgets.
EOF
}

prometheus_url=''
evidence_dir=''
window='10m'
currency='CNY'
baseline_file=''
capture_only=false
max_http_error_rate='0.05'
max_http_p95_seconds='10'
min_agent_run_success_rate='0.95'
max_agent_cost='100'
max_queue_depth='100'
max_queue_lag_p95_seconds='60'
max_http_error_rate_increase='0.01'
max_http_p95_seconds_increase='1'
max_agent_run_success_rate_decrease='0.01'
max_agent_cost_increase='10'
max_queue_depth_increase='10'
max_queue_lag_p95_seconds_increase='10'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prometheus-url) prometheus_url="${2:-}"; shift 2 ;;
    --evidence-dir) evidence_dir="${2:-}"; shift 2 ;;
    --window) window="${2:-}"; shift 2 ;;
    --currency) currency="${2:-}"; shift 2 ;;
    --baseline-file) baseline_file="${2:-}"; shift 2 ;;
    --capture-only) capture_only=true; shift ;;
    --max-http-error-rate) max_http_error_rate="${2:-}"; shift 2 ;;
    --max-http-p95-seconds) max_http_p95_seconds="${2:-}"; shift 2 ;;
    --min-agent-run-success-rate) min_agent_run_success_rate="${2:-}"; shift 2 ;;
    --max-agent-cost) max_agent_cost="${2:-}"; shift 2 ;;
    --max-queue-depth) max_queue_depth="${2:-}"; shift 2 ;;
    --max-queue-lag-p95-seconds) max_queue_lag_p95_seconds="${2:-}"; shift 2 ;;
    --max-http-error-rate-increase) max_http_error_rate_increase="${2:-}"; shift 2 ;;
    --max-http-p95-seconds-increase) max_http_p95_seconds_increase="${2:-}"; shift 2 ;;
    --max-agent-run-success-rate-decrease) max_agent_run_success_rate_decrease="${2:-}"; shift 2 ;;
    --max-agent-cost-increase) max_agent_cost_increase="${2:-}"; shift 2 ;;
    --max-queue-depth-increase) max_queue_depth_increase="${2:-}"; shift 2 ;;
    --max-queue-lag-p95-seconds-increase) max_queue_lag_p95_seconds_increase="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$prometheus_url" =~ ^https?://[^[:space:]]+$ ]] || die '--prometheus-url 必须是 http(s) URL'
[[ "$window" =~ ^[1-9][0-9]*[smhdwy]$ ]] || die '--window 必须是 Prometheus duration，例如 10m'
[[ "$currency" =~ ^[A-Z]{3,8}$ ]] || die '--currency 必须是大写货币代码'
[[ -n "$evidence_dir" && "$evidence_dir" = /* ]] || die '--evidence-dir 必须是绝对路径'
require_command curl
require_command jq
require_command mktemp
require_safe_directory "$evidence_dir"

if [[ -n "$baseline_file" ]]; then
  require_regular_file "$baseline_file"
fi

is_number() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$ ]]
}

require_number() {
  is_number "$2" || die "$1 必须是非负数"
}

for threshold in \
  max_http_error_rate="$max_http_error_rate" \
  max_http_p95_seconds="$max_http_p95_seconds" \
  min_agent_run_success_rate="$min_agent_run_success_rate" \
  max_agent_cost="$max_agent_cost" \
  max_queue_depth="$max_queue_depth" \
  max_queue_lag_p95_seconds="$max_queue_lag_p95_seconds" \
  max_http_error_rate_increase="$max_http_error_rate_increase" \
  max_http_p95_seconds_increase="$max_http_p95_seconds_increase" \
  max_agent_run_success_rate_decrease="$max_agent_run_success_rate_decrease" \
  max_agent_cost_increase="$max_agent_cost_increase" \
  max_queue_depth_increase="$max_queue_depth_increase" \
  max_queue_lag_p95_seconds_increase="$max_queue_lag_p95_seconds_increase"; do
  require_number "${threshold%%=*}" "${threshold#*=}"
done

query_metric() {
  local name="$1"
  local query="$2"
  local response
  local value

  response="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 20 --get \
    --data-urlencode "query=$query" "${prometheus_url%/}/api/v1/query")" \
    || die "Prometheus 查询失败：$name"
  value="$(jq -er '
    if .status != "success" then error("Prometheus status is not success")
    elif (.data.result | type) != "array" or (.data.result | length) != 1 then error("expected exactly one vector result")
    else .data.result[0].value[1]
    end
  ' <<<"$response")" || die "Prometheus 指标无有效单值：$name"
  is_number "$value" || die "Prometheus 指标不是有限数字：$name"
  printf '%s' "$value"
}

float_le() {
  awk -v actual="$1" -v expected="$2" 'BEGIN { exit !(actual <= expected) }'
}

float_ge() {
  awk -v actual="$1" -v expected="$2" 'BEGIN { exit !(actual >= expected) }'
}

failures_json='[]'
add_failure() {
  failures_json="$(jq -cn --argjson current "$failures_json" --arg message "$1" '$current + [$message]')"
}

check_max() {
  local name="$1"
  local actual="$2"
  local maximum="$3"
  float_le "$actual" "$maximum" || add_failure "$name exceeds maximum"
}

check_min() {
  local name="$1"
  local actual="$2"
  local minimum="$3"
  float_ge "$actual" "$minimum" || add_failure "$name is below minimum"
}

http_error_rate="$(query_metric http_error_rate "sum(rate(http_request_errors_total{app=\"quant-server\",status_code=~\"5..\"}[$window])) / clamp_min(sum(rate(http_requests_total{app=\"quant-server\"}[$window])), 1)")"
http_p95_seconds="$(query_metric http_p95_seconds "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{app=\"quant-server\"}[$window])))")"
agent_run_success_rate="$(query_metric agent_run_success_rate "sum(increase(agent_runs_total{status=\"COMPLETED\"}[$window])) / clamp_min(sum(increase(agent_runs_total[$window])), 1)")"
agent_cost="$(query_metric agent_cost "sum(increase(agent_model_cost_total{currency=\"$currency\"}[$window]))")"
queue_depth="$(query_metric queue_depth 'max(bullmq_queue_depth{queue="agent-execution"})')"
queue_lag_p95_seconds="$(query_metric queue_lag_p95_seconds "histogram_quantile(0.95, sum by (le) (rate(bullmq_enqueue_lag_seconds_bucket{queue=\"agent-execution\"}[$window])))")"

if [[ "$capture_only" = false ]]; then
  check_max http_error_rate "$http_error_rate" "$max_http_error_rate"
  check_max http_p95_seconds "$http_p95_seconds" "$max_http_p95_seconds"
  check_min agent_run_success_rate "$agent_run_success_rate" "$min_agent_run_success_rate"
  check_max agent_cost "$agent_cost" "$max_agent_cost"
  check_max queue_depth "$queue_depth" "$max_queue_depth"
  check_max queue_lag_p95_seconds "$queue_lag_p95_seconds" "$max_queue_lag_p95_seconds"
fi

if [[ -n "$baseline_file" ]]; then
  baseline_schema_version="$(jq -er '.schemaVersion' "$baseline_file")" || die 'baseline 缺少 schemaVersion'
  baseline_window="$(jq -er '.window' "$baseline_file")" || die 'baseline 缺少 window'
  baseline_currency="$(jq -er '.currency' "$baseline_file")" || die 'baseline 缺少 currency'
  [[ "$baseline_schema_version" = '1' ]] || die 'baseline schemaVersion 不受支持'
  [[ "$baseline_window" = "$window" ]] || die 'baseline window 必须与当前检查一致'
  [[ "$baseline_currency" = "$currency" ]] || die 'baseline currency 必须与当前检查一致'
  baseline_http_error_rate="$(jq -er '.metrics.httpErrorRate' "$baseline_file")" || die 'baseline 缺少 metrics.httpErrorRate'
  baseline_http_p95_seconds="$(jq -er '.metrics.httpP95Seconds' "$baseline_file")" || die 'baseline 缺少 metrics.httpP95Seconds'
  baseline_agent_run_success_rate="$(jq -er '.metrics.agentRunSuccessRate' "$baseline_file")" || die 'baseline 缺少 metrics.agentRunSuccessRate'
  baseline_agent_cost="$(jq -er '.metrics.agentCost' "$baseline_file")" || die 'baseline 缺少 metrics.agentCost'
  baseline_queue_depth="$(jq -er '.metrics.queueDepth' "$baseline_file")" || die 'baseline 缺少 metrics.queueDepth'
  baseline_queue_lag_p95_seconds="$(jq -er '.metrics.queueLagP95Seconds' "$baseline_file")" || die 'baseline 缺少 metrics.queueLagP95Seconds'

  for metric in \
    baseline_http_error_rate="$baseline_http_error_rate" \
    baseline_http_p95_seconds="$baseline_http_p95_seconds" \
    baseline_agent_run_success_rate="$baseline_agent_run_success_rate" \
    baseline_agent_cost="$baseline_agent_cost" \
    baseline_queue_depth="$baseline_queue_depth" \
    baseline_queue_lag_p95_seconds="$baseline_queue_lag_p95_seconds"; do
    is_number "${metric#*=}" || die "baseline 指标无效：${metric%%=*}"
  done

  check_max http_error_rate_regression "$http_error_rate" "$(awk -v base="$baseline_http_error_rate" -v budget="$max_http_error_rate_increase" 'BEGIN { print base + budget }')"
  check_max http_p95_seconds_regression "$http_p95_seconds" "$(awk -v base="$baseline_http_p95_seconds" -v budget="$max_http_p95_seconds_increase" 'BEGIN { print base + budget }')"
  check_min agent_run_success_rate_regression "$agent_run_success_rate" "$(awk -v base="$baseline_agent_run_success_rate" -v budget="$max_agent_run_success_rate_decrease" 'BEGIN { print base - budget }')"
  check_max agent_cost_regression "$agent_cost" "$(awk -v base="$baseline_agent_cost" -v budget="$max_agent_cost_increase" 'BEGIN { print base + budget }')"
  check_max queue_depth_regression "$queue_depth" "$(awk -v base="$baseline_queue_depth" -v budget="$max_queue_depth_increase" 'BEGIN { print base + budget }')"
  check_max queue_lag_p95_seconds_regression "$queue_lag_p95_seconds" "$(awk -v base="$baseline_queue_lag_p95_seconds" -v budget="$max_queue_lag_p95_seconds_increase" 'BEGIN { print base + budget }')"
fi

recorded_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
result='passed'
if [[ "$capture_only" = true ]]; then
  result='captured'
elif [[ "$failures_json" != '[]' ]]; then
  result='failed'
fi

evidence_file="$(mktemp "$evidence_dir/canary-metrics-${recorded_at//[:]/}-XXXXXX")"
jq -n \
  --arg recordedAt "$recorded_at" \
  --arg window "$window" \
  --arg currency "$currency" \
  --arg result "$result" \
  --argjson httpErrorRate "$http_error_rate" \
  --argjson httpP95Seconds "$http_p95_seconds" \
  --argjson agentRunSuccessRate "$agent_run_success_rate" \
  --argjson agentCost "$agent_cost" \
  --argjson queueDepth "$queue_depth" \
  --argjson queueLagP95Seconds "$queue_lag_p95_seconds" \
  --argjson failures "$failures_json" \
  '{schemaVersion: 1, recordedAt: $recordedAt, window: $window, currency: $currency, result: $result, metrics: {httpErrorRate: $httpErrorRate, httpP95Seconds: $httpP95Seconds, agentRunSuccessRate: $agentRunSuccessRate, agentCost: $agentCost, queueDepth: $queueDepth, queueLagP95Seconds: $queueLagP95Seconds}, failures: $failures}' \
  > "$evidence_file"
chmod 600 "$evidence_file"

printf 'canaryResult=%s\nevidence=%s\n' "$result" "$evidence_file"
[[ "$result" != 'failed' ]] || exit 1
