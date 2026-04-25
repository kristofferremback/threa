#!/usr/bin/env bash
set -euo pipefail

# Codex Cloud quick test pass: unit tests only, excluding DB/browser/intent-heavy suites.
# Runs backend unit tests from src/ and excludes agent/intent paths.

cd "$(dirname "$0")/.."

mapfile -t backend_unit_files < <(
  rg --files apps/backend/src \
    -g '*.test.ts' \
    -g '!**/features/agents/**' \
    -g '!**/*intent*.test.ts' \
    | sed 's#^apps/backend/##' \
    | sort
)

if [[ ${#backend_unit_files[@]} -eq 0 ]]; then
  echo "No eligible non-DB backend unit tests found."
  exit 1
fi

bun scripts/test-silent.ts backend-unit "${backend_unit_files[@]}"
