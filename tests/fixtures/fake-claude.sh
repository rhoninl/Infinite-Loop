#!/usr/bin/env bash
# Fake CLI for testing the provider runner (lib/server/providers/runner.ts).
# Backs both the "claude-stream-json" and "plain" output-format paths.
#
# Configurable via env vars:
#   FAKE_STDOUT_LINES           Newline-delimited stdout payload (default: two lines).
#   FAKE_DELAY_MS_BETWEEN_LINES Sleep between lines in ms (default 0).
#   FAKE_SLEEP_MS_BEFORE_EXIT   Sleep at end before exiting in ms (default 0).
#   FAKE_EXIT_CODE              Numeric exit code (default 0).
#   FAKE_STDERR                 Optional stderr line.
#
# Judge mode (lib/server/nodes/judge.ts). When any of these are set, the
# script emits a single JSON line on stdout and ignores FAKE_STDOUT_LINES:
#   FAKE_CLAUDE_JUDGE_WINNER    Winner index (e.g. "2"). Triggers judge mode.
#   FAKE_CLAUDE_JUDGE_SCORES    Optional comma-separated scores override
#                               (e.g. "5,7,9"). Length need not match.
#   FAKE_CLAUDE_JUDGE_BAD       When set non-empty, emit malformed JSON
#                               (e.g. "not json") instead. Forces the judge
#                               executor's retry / error path.
#
# CLI args (e.g. --print and the prompt) are intentionally ignored.

ms_to_s() {
  # Convert integer milliseconds to a decimal seconds string for `sleep`.
  local ms="$1"
  if [ -z "$ms" ] || [ "$ms" = "0" ]; then
    echo "0"
    return
  fi
  awk -v m="$ms" 'BEGIN { printf "%.3f", m / 1000 }'
}

LINES="${FAKE_STDOUT_LINES:-line one
line two}"
BETWEEN_MS="${FAKE_DELAY_MS_BETWEEN_LINES:-0}"
END_MS="${FAKE_SLEEP_MS_BEFORE_EXIT:-0}"
EXIT_CODE="${FAKE_EXIT_CODE:-0}"

if [ -n "${FAKE_STDERR:-}" ]; then
  printf '%s\n' "$FAKE_STDERR" >&2
fi

# Judge mode short-circuits everything else — emit one line and exit.
if [ -n "${FAKE_CLAUDE_JUDGE_BAD:-}" ]; then
  printf '%s\n' "not json"
  exit "${FAKE_EXIT_CODE:-0}"
fi
if [ -n "${FAKE_CLAUDE_JUDGE_WINNER:-}" ]; then
  winner="$FAKE_CLAUDE_JUDGE_WINNER"
  if [ -n "${FAKE_CLAUDE_JUDGE_SCORES:-}" ]; then
    # Build "[a, b, c]" from "a,b,c".
    scores_json="[$(printf '%s' "$FAKE_CLAUDE_JUDGE_SCORES" | sed 's/,/, /g')]"
  else
    # Default: scores of length max(winner+1, 3), filled with 5, with 9 at winner.
    len="$winner"
    if [ "$len" -lt 2 ]; then
      len=2
    fi
    len=$((len + 1))
    parts=""
    i=0
    while [ "$i" -lt "$len" ]; do
      if [ "$i" -eq "$winner" ]; then
        v=9
      else
        v=5
      fi
      if [ -z "$parts" ]; then
        parts="$v"
      else
        parts="$parts, $v"
      fi
      i=$((i + 1))
    done
    scores_json="[$parts]"
  fi
  printf '{"winner_index": %s, "scores": %s, "reasoning": "fake"}\n' \
    "$winner" "$scores_json"
  exit "${FAKE_EXIT_CODE:-0}"
fi

between_s="$(ms_to_s "$BETWEEN_MS")"
first=1
while IFS= read -r line; do
  if [ "$first" -eq 0 ] && [ "$between_s" != "0" ]; then
    sleep "$between_s"
  fi
  printf '%s\n' "$line"
  first=0
done <<EOF
$LINES
EOF

end_s="$(ms_to_s "$END_MS")"
if [ "$end_s" != "0" ]; then
  sleep "$end_s"
fi

exit "$EXIT_CODE"
