#!/usr/bin/env bash
# Deploy to an existing service, check the exact commit, then promote that revision.
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID explicitly}"
: "${REGION:?Set REGION explicitly}"
: "${SERVICE:?Set SERVICE explicitly}"
: "${IMAGE:?Set IMAGE explicitly}"
: "${GIT_SHA:?Set the full commit SHA}"
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'GIT_SHA must be a full commit SHA' >&2; exit 1; }
deploy_work=$(mktemp -d)
promotion_attempted=false
service_args=(--project "$PROJECT_ID" --region "$REGION" --platform managed)

# Compare concrete revision percentages, ignoring tag-only zero-traffic entries.
traffic_matches() {
  python3 - "$1" "$2" <<'PYTRAFFIC'
import json,sys
actual={}
for row in json.load(open(sys.argv[1]))['status']['traffic']:
    percent=row.get('percent',0)
    if percent>0:
        revision=row['revisionName']
        actual[revision]=actual.get(revision,0)+percent
expected={}
for item in sys.argv[2].split(','):
    revision,percent=item.rsplit('=',1)
    expected[revision]=expected.get(revision,0)+int(percent)
if sum(actual.values())!=100 or actual!=expected:
    raise SystemExit(f'Traffic mismatch: expected {expected}, observed {actual}')
PYTRAFFIC
}

rollback() {
  result=$?
  if [[ "$result" -ne 0 && "$promotion_attempted" == true ]]; then
    echo 'Verification failed; restoring the captured traffic split' >&2
    if ! gcloud run services update-traffic "$SERVICE" "${service_args[@]}" --to-revisions="$rollback_traffic"; then
      echo "CRITICAL: automatic rollback failed; restore $rollback_traffic" >&2
    elif ! gcloud run services describe "$SERVICE" "${service_args[@]}" --format=json > "$deploy_work/rollback.json"; then
      echo "CRITICAL: cannot verify rollback; inspect and restore $rollback_traffic" >&2
    elif ! traffic_matches "$deploy_work/rollback.json" "$rollback_traffic"; then
      echo "CRITICAL: rollback command succeeded but captured traffic was not restored: $rollback_traffic" >&2
    else
      echo "Verified rollback traffic split: $rollback_traffic" >&2
    fi
  fi
  rm -rf "$deploy_work"
  exit "$result"
}
trap rollback EXIT

# Read and validate the current traffic before any change. Never implicitly create a service.
gcloud run services describe "$SERVICE" "${service_args[@]}" --format=json > "$deploy_work/before.json"
rollback_traffic=$(python3 - "$deploy_work/before.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]));traffic=d['status']['traffic']
rows=[(r['revisionName'],r['percent']) for r in traffic if r.get('percent',0)>0]
assert sum(p for _,p in rows)==100, 'Existing traffic must total 100 percent'
print(','.join(f'{r}={p}' for r,p in rows))
PY
)


revision_suffix="git-${GIT_SHA:0:12}-${GITHUB_RUN_ID:-$(date +%s)}"
revision="$SERVICE-$revision_suffix"
tag="sha-${GIT_SHA:0:12}"
gcloud run deploy "$SERVICE" "${service_args[@]}" --image "$IMAGE:$GIT_SHA" \
  --revision-suffix "$revision_suffix" --no-traffic --tag "$tag"
gcloud run services describe "$SERVICE" "${service_args[@]}" --format=json > "$deploy_work/after.json"
canary_url=$(python3 - "$deploy_work/after.json" "$tag" "$revision" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]));matches=[r for r in d['status']['traffic'] if r.get('tag')==sys.argv[2] and r.get('revisionName')==sys.argv[3]]
assert len(matches)==1 and matches[0].get('url'), 'Tagged canary does not match requested revision'
print(matches[0]['url'])
PY
)
verify_url() {
  curl --fail --silent --show-error --max-time 30 "$1/health" > "$deploy_work/health.json"
  curl --fail --silent --show-error --max-time 30 "$1/ready" > "$deploy_work/ready.json"
  python3 - "$deploy_work/health.json" "$deploy_work/ready.json" "$GIT_SHA" <<'PY'
import json,sys
health=json.load(open(sys.argv[1]));ready=json.load(open(sys.argv[2]))
assert health.get('status')=='healthy' and health.get('commit')==sys.argv[3], 'Health commit mismatch'
assert ready.get('status')=='ready', 'Anonymous readiness failed'
PY
}
verify_url "$canary_url"
promotion_attempted=true
gcloud run services update-traffic "$SERVICE" "${service_args[@]}" --to-revisions="$revision=100"
gcloud run services describe "$SERVICE" "${service_args[@]}" --format=json > "$deploy_work/promoted.json"
traffic_matches "$deploy_work/promoted.json" "$revision=100"
service_url=$(python3 - "$deploy_work/after.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['status']['url'])
PY
)
verify_url "$service_url"
echo "Verified $GIT_SHA on $revision at $service_url"
