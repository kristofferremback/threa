#!/bin/bash
#
# INV-22 Enforcement Hook
#
# Detects when Claude dismisses test failures as "pre-existing" or "unrelated"
# and blocks the response with a reminder to fix them.
#
# Triggered on: Stop event (when Claude finishes responding)

set -euo pipefail

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Extract the last assistant message from the transcript
# The transcript is a JSON array of messages
LAST_ASSISTANT_TEXT=$(jq -r '
  [.[] | select(.type == "assistant")] | last |
  if .message then
    [.message[] | select(.type == "text") | .text] | join(" ")
  else
    ""
  end
' "$TRANSCRIPT_PATH" 2>/dev/null || echo "")

if [[ -z "$LAST_ASSISTANT_TEXT" ]]; then
  exit 0
fi

# Patterns that indicate dismissing test failures
DISMISSIVE_PATTERNS=(
  "pre-existing error"
  "pre-existing failure"
  "pre-existing test"
  "preexisting error"
  "preexisting failure"
  "preexisting test"
  "unrelated test failure"
  "unrelated failure"
  "unrelated error"
  "already failing"
  "was already broken"
  "not caused by"
  "not related to"
  "existed before"
)

for pattern in "${DISMISSIVE_PATTERNS[@]}"; do
  if echo "$LAST_ASSISTANT_TEXT" | grep -iq "$pattern"; then
    jq -n '{
      "decision": "block",
      "reason": "INV-22 VIOLATION: Never dismiss test failures as \"pre-existing\" or \"unrelated\".\n\nFailing tests mean one of:\n1. You broke something - fix it\n2. Flaky test - fix the flakiness\n3. Test merged to main broken - fix it in a separate commit\n\nInvestigate the actual error. Understand what is failing and why. Fix it. Confirm the test passes."
    }'
    exit 0
  fi
done

exit 0
