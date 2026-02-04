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
    # Output a reminder (not a block) - Claude will see this message but can continue
    jq -n '{
      "decision": "warn",
      "message": "INV-22 Reminder: Test failures should not be dismissed as \"pre-existing\" or \"unrelated\".\n\nPlease investigate: What is actually failing? Why? Can you fix it?\n\nIf genuinely unrelated to your changes, fix it in a separate commit."
    }'
    exit 0
  fi
done

exit 0
