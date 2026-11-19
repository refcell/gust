#!/usr/bin/env bash
# Which Actions cache of h/, hlf/ and the upload manifest (copybook-h-*) a Copybook data run builds on.
# Nov 16: curated runs that restored the cache before a full run saved its own, then saved theirs after it, became
# the newest cache, and every later curated run restored them. The full run's hlf/ (with hlf/BUILD, which carries
# meta/builds.json stores.hl.data_built_at) never reached a curated run, and a curated upload could have sent
# older hl/ to the API.
#   pick           newest cache saved by a full run, or by a curated run that no full run superseded (-v2 keys)
#   superseded T0  1 when a full run saved its cache after T0, the time this run restored its own: this run's hlf/
#                  is older than the full run's, so it neither uploads, saves its cache, nor publishes its hl/
#   filing-active  number of other curated filing runs (reason "filing ...") queued or running; 1 if GitHub can't say,
#                  so a keepalive yields when unsure
#   keepalive-uploading  1 while another curated keepalive is in its upload step
set -uo pipefail
R=${GITHUB_REPOSITORY:-refcell/gust}
full() { gh api "repos/$R/actions/runs/$1" --jq '.display_title' 2>/dev/null | grep -q '(full)'; }
case "${1:-}" in
  pick)
    for k in $(gh api "repos/$R/actions/caches?key=copybook-h-&sort=created_at&direction=desc&per_page=50" \
        --jq '.actions_caches[].key'); do
      id=${k#copybook-h-}
      if [[ $id =~ ^[0-9]+-v2$ ]] || { [[ $id =~ ^[0-9]+$ ]] && full "$id"; }; then echo "$k"; exit 0; fi
    done
    ;;
  superseded)
    t0=$2
    since=$(date -u -d '-8 hours' +%FT%TZ)
    for id in $(gh api "repos/$R/actions/workflows/copybook-data.yml/runs?per_page=50" --jq \
        ".workflow_runs[] | select(.display_title | contains(\"(full)\")) | select(.created_at > \"$since\") | .id"); do
      saved=$(gh api "repos/$R/actions/runs/$id/jobs" --jq '[.jobs[] | select(.name == "refresh") | .steps[]
        | select(.name == "Run actions/cache/save@v4") | select(.conclusion == "success")][0].completed_at // ""')
      if [ -n "$saved" ] && [[ "$saved" > "$t0" ]]; then echo 1; exit 0; fi
    done
    echo 0
    ;;
  filing-active)
    gh api "repos/$R/actions/workflows/copybook-data.yml/runs?per_page=40" --jq "[.workflow_runs[]
      | select(.status != \"completed\") | select(.id != ${GITHUB_RUN_ID:-0})
      | select(.display_title | contains(\"(curated) filing\"))] | length" 2>/dev/null || echo 1
    ;;
  keepalive-uploading)
    for id in $(gh api "repos/$R/actions/workflows/copybook-data.yml/runs?status=in_progress&per_page=20" --jq \
        ".workflow_runs[] | select(.id != ${GITHUB_RUN_ID:-0}) | select(.display_title | contains(\"(curated)\"))
        | select(.display_title | contains(\"(curated) filing\") | not) | .id"); do
      n=$(gh api "repos/$R/actions/runs/$id/jobs" --jq '[.jobs[] | select(.name == "refresh") | .steps[]
        | select(.name == "Upload paid history to R2" and .status == "in_progress")] | length')
      if [ "${n:-0}" != 0 ]; then echo 1; exit 0; fi
    done
    echo 0
    ;;
esac
