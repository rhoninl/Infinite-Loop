#!/usr/bin/env bash
# Fake claude binary for judge condition tests.
# - Prints FAKE_JUDGE_OUTPUT (default "MET").
# - Sleeps FAKE_JUDGE_SLEEP_MS milliseconds before exiting (default 0).
# - Exits with FAKE_JUDGE_EXIT (default 0).

OUTPUT="${FAKE_JUDGE_OUTPUT-MET}"
SLEEP_MS="${FAKE_JUDGE_SLEEP_MS-0}"
EXIT_CODE="${FAKE_JUDGE_EXIT-0}"

printf '%s\n' "$OUTPUT"

if [ "$SLEEP_MS" -gt 0 ]; then
  sleep "$(awk "BEGIN { printf \"%f\", ${SLEEP_MS}/1000 }")"
fi

exit "$EXIT_CODE"
