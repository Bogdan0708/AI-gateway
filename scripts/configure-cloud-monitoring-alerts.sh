#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-mitch-ai-services}"
SERVICE_NAME="${SERVICE_NAME:-ai-gateway}"
CONCURRENCY_LIMIT="${CONCURRENCY_LIMIT:-20}"
NOTIFICATION_CHANNELS_CSV="${NOTIFICATION_CHANNELS_CSV:-}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
}

require_cmd gcloud
require_cmd jq

if ! [[ "$CONCURRENCY_LIMIT" =~ ^[0-9]+$ ]]; then
  echo "CONCURRENCY_LIMIT must be an integer, got: $CONCURRENCY_LIMIT" >&2
  exit 1
fi

THRESHOLD_CONCURRENCY="$(awk "BEGIN { printf \"%.2f\", $CONCURRENCY_LIMIT * 0.8 }")"

if [[ -n "$NOTIFICATION_CHANNELS_CSV" ]]; then
  CHANNELS_JSON="$(printf '%s\n' "$NOTIFICATION_CHANNELS_CSV" | tr ',' '\n' | sed '/^$/d' | jq -R . | jq -s .)"
else
  CHANNELS_JSON='[]'
fi

ensure_log_metric() {
  local metric_name="$1"
  local description="$2"
  local filter="$3"

  if gcloud logging metrics describe "$metric_name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Log metric exists: $metric_name"
    return
  fi

  echo "Creating log metric: $metric_name"
  gcloud logging metrics create "$metric_name" \
    --project "$PROJECT_ID" \
    --description "$description" \
    --log-filter "$filter"
}

upsert_policy() {
  local display_name="$1"
  local policy_file="$2"

  local existing
  existing="$(gcloud alpha monitoring policies list \
    --project "$PROJECT_ID" \
    --filter "displayName=\"$display_name\"" \
    --format 'value(name)')"

  if [[ -n "$existing" ]]; then
    echo "Replacing policy: $display_name"
    while IFS= read -r policy_name; do
      [[ -z "$policy_name" ]] && continue
      gcloud alpha monitoring policies delete "$policy_name" --project "$PROJECT_ID" --quiet
    done <<<"$existing"
  else
    echo "Creating policy: $display_name"
  fi

  gcloud alpha monitoring policies create \
    --project "$PROJECT_ID" \
    --policy-from-file "$policy_file"
}

FALLBACK_LOG_FILTER=$(cat <<EOT
resource.type="cloud_run_revision"
resource.labels.service_name="$SERVICE_NAME"
jsonPayload.msg=~"(chat completion succeeded|simple completion succeeded)"
jsonPayload.isFallback=true
EOT
)

COMPLETION_LOG_FILTER=$(cat <<EOT
resource.type="cloud_run_revision"
resource.labels.service_name="$SERVICE_NAME"
jsonPayload.msg=~"(chat completion succeeded|simple completion succeeded)"
EOT
)

ensure_log_metric \
  "ai_gateway_fallback_total" \
  "Count of successful completions served via fallback provider" \
  "$FALLBACK_LOG_FILTER"

ensure_log_metric \
  "ai_gateway_completion_total" \
  "Count of successful chat/simple completions" \
  "$COMPLETION_LOG_FILTER"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cat > "$WORKDIR/error-rate-policy.json" <<EOF_JSON
{
  "displayName": "AI Gateway - Global error rate > 5% (5m)",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Cloud Run 5xx ratio above 5%",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"$SERVICE_NAME\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.\"response_code_class\"=\"5xx\"",
        "denominatorFilter": "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"$SERVICE_NAME\" AND metric.type=\"run.googleapis.com/request_count\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.05,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.label.\"service_name\""]
          }
        ],
        "denominatorAggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.label.\"service_name\""]
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" },
  "enabled": true,
  "notificationChannels": $CHANNELS_JSON
}
EOF_JSON

cat > "$WORKDIR/latency-policy.json" <<EOF_JSON
{
  "displayName": "AI Gateway - P95 latency > 5s (5m)",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Cloud Run request p95 latency above 5s",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"$SERVICE_NAME\" AND metric.type=\"run.googleapis.com/request_latencies\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 5000,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_PERCENTILE_95",
            "crossSeriesReducer": "REDUCE_MAX",
            "groupByFields": ["resource.label.\"service_name\""]
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" },
  "enabled": true,
  "notificationChannels": $CHANNELS_JSON
}
EOF_JSON

cat > "$WORKDIR/concurrency-policy.json" <<EOF_JSON
{
  "displayName": "AI Gateway - Concurrency > 80% of limit (5m)",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Cloud Run concurrent requests above 80%",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"$SERVICE_NAME\" AND metric.type=\"run.googleapis.com/container/concurrent_requests\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": $THRESHOLD_CONCURRENCY,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_MEAN",
            "crossSeriesReducer": "REDUCE_MAX",
            "groupByFields": ["resource.label.\"service_name\""]
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" },
  "enabled": true,
  "notificationChannels": $CHANNELS_JSON
}
EOF_JSON

cat > "$WORKDIR/fallback-policy.json" <<EOF_JSON
{
  "displayName": "AI Gateway - Provider fallback rate > 10% (5m)",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Fallback ratio above 10%",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"$SERVICE_NAME\" AND metric.type=\"logging.googleapis.com/user/ai_gateway_fallback_total\"",
        "denominatorFilter": "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"$SERVICE_NAME\" AND metric.type=\"logging.googleapis.com/user/ai_gateway_completion_total\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.10,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.label.\"service_name\""]
          }
        ],
        "denominatorAggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.label.\"service_name\""]
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" },
  "enabled": true,
  "notificationChannels": $CHANNELS_JSON
}
EOF_JSON

upsert_policy "AI Gateway - Global error rate > 5% (5m)" "$WORKDIR/error-rate-policy.json"
upsert_policy "AI Gateway - P95 latency > 5s (5m)" "$WORKDIR/latency-policy.json"
upsert_policy "AI Gateway - Concurrency > 80% of limit (5m)" "$WORKDIR/concurrency-policy.json"
upsert_policy "AI Gateway - Provider fallback rate > 10% (5m)" "$WORKDIR/fallback-policy.json"

echo "Configured 4 Cloud Monitoring policies for service '$SERVICE_NAME' in project '$PROJECT_ID'."
