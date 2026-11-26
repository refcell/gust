# Sourced by copybook-keepalive.yml. ghr: gh with retries on GitHub's 5xx and network errors (Nov 25: one HTTP 500
# listing runs at 16:25Z ended the keepalive chain, and with it the curated runs and the stale check it dispatches).
# Retries back off from GH_RETRY_FIRST_S up to 5 minutes, for up to GH_RETRY_S (30 minutes) per call; then it prints
# an ::error and returns gh's status, so the job fails loudly and copybook-stale.yml's own cron is left as the alarm.
# Any other error (a 4xx, a bad argument) returns at once, as before.
ghr() {
  local deadline=$((SECONDS + ${GH_RETRY_S:-1800})) wait=${GH_RETRY_FIRST_S:-10} out rc err
  err=$(mktemp)
  while :; do
    out=$(gh "$@" 2>"$err") && rc=0 || rc=$?
    if [ "$rc" = 0 ]; then
      rm -f "$err"
      if [ -n "$out" ]; then printf '%s\n' "$out"; fi
      return 0
    fi
    if ! grep -qiE 'HTTP 5[0-9][0-9]|timed? ?out|connection (reset|refused)|unexpected EOF|no such host|TLS handshake|server misbehaving' "$err"; then
      cat "$err" >&2; rm -f "$err"
      return "$rc"
    fi
    if [ $((SECONDS + wait)) -gt "$deadline" ]; then
      echo "::error::gh $1 $2 still failing after ${GH_RETRY_S:-1800} s of retries: $(tr '\n' ' ' < "$err")" >&2
      rm -f "$err"
      return "$rc"
    fi
    echo "::warning::gh $1 $2: $(tr '\n' ' ' < "$err"); retrying in ${wait} s" >&2
    sleep "$wait"
    wait=$((wait * 2 > 300 ? 300 : wait * 2))
  done
}
