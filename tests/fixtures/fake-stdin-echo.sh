#!/usr/bin/env bash
# Fake CLI that prints a prefix line, then echoes its stdin verbatim.
# Used by runProvider's stdin-delivery test (promptVia: "stdin").
echo "PROMPT_VIA_STDIN_BEGIN"
cat
