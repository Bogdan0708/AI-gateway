# Cloud Monitoring Alerts (GCP)

This repository includes an idempotent setup script for the AI Gateway Cloud Monitoring alerts.

## What gets configured

The script configures these alert policies for Cloud Run service `ai-gateway`:

- Provider fallback rate `> 10%` over `5m`
- Global error rate (`5xx / total requests`) `> 5%` over `5m`
- P95 request latency `> 5s` over `5m`
- Concurrent requests `> 80%` of configured per-container limit over `5m`

It also ensures two logs-based metrics exist:

- `logging.googleapis.com/user/ai_gateway_fallback_total`
- `logging.googleapis.com/user/ai_gateway_completion_total`

## Prerequisites

- `gcloud` authenticated to the target project
- `jq` installed
- Cloud Monitoring notification channels created (optional, but recommended)

## Usage

```bash
chmod +x scripts/configure-cloud-monitoring-alerts.sh

PROJECT_ID=mitch-ai-services \
SERVICE_NAME=ai-gateway \
CONCURRENCY_LIMIT=20 \
NOTIFICATION_CHANNELS_CSV="projects/mitch-ai-services/notificationChannels/1234567890,projects/mitch-ai-services/notificationChannels/0987654321" \
./scripts/configure-cloud-monitoring-alerts.sh
```

Notes:

- `CONCURRENCY_LIMIT` should match the deployed Cloud Run container concurrency.
- `NOTIFICATION_CHANNELS_CSV` can be omitted; policies are still created.
- Running the script again replaces policies with the same display names.
