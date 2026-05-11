---
name: commit
description: Create a git commit with proper message formatting. Use when asked to commit changes, handles sandbox heredoc limitations.
---

# Create Git Commit

Create a git commit with a properly formatted message, working around sandbox heredoc limitations.

## Instructions

### 1. Detect Harness and Model

Determine which AI harness is in use, then detect the model:

```bash
# Harness detection
if [ -n "$OPENCODE" ]; then
  HARNESS="opencode"
elif [ -n "$CODEX" ] || [ -n "$CODEX_CLI" ]; then
  HARNESS="codex"
else
  HARNESS="claude"
fi
echo "HARNESS=$HARNESS"
```

Model detection by harness:

| Harness | Detection method |
|---------|-----------------|
| OpenCode | Check the system prompt for "You are powered by the model named X" |
| Codex | Check the system prompt for model name (e.g. "ChatGPT 5.5") |
| Claude Code | Check the system prompt for model version (e.g. "Claude Opus 4.7") |

Set `MODEL` to the detected model name (e.g. `DeepSeek V4 Pro`, `ChatGPT 5.5`, `Claude Opus 4.7`).

### 2. Resolve Attribution

Build the commit footer lines from `$HARNESS` and `$MODEL`:

| Harness | Generated with | Co-Authored-By |
|---------|---------------|----------------|
| claude | `🤖 Generated with [Claude Code](https://claude.com/claude-code)` | `Co-Authored-By: $MODEL <noreply@anthropic.com>` |
| codex | `🤖 Generated with [Codex](https://github.com/openai/codex)` | `Co-authored-by: codex <codex@users.noreply.github.com>` |
| opencode | `🤖 Generated with [OpenCode](https://opencode.ai)` | `Co-Authored-By: $MODEL <noreply@opencode.ai>` |

### 3. Check what to commit

```bash
# See status
git status

# See staged changes
git diff --cached --stat

# See recent commits for style reference
git log --oneline -5

# Extract Linear ticket ID from branch name (if present)
git branch --show-current | grep -oiE 'thr-[0-9]+' | tr '[:lower:]' '[:upper:]'
```

### 4. Write the commit message to a temp file

Use `.tmp/` (gitignored, no sandbox approval needed):

```bash
mkdir -p .tmp
```

```bash
# Single-line message
printf '%s\n' 'type: short description' > .tmp/commit-msg.txt

# Multi-line message (each line as a separate argument)
printf '%s\n' \
  'type: short description' \
  '' \
  '- Detail 1' \
  '- Detail 2' \
  '' \
  '🤖 Generated with [OpenCode](https://opencode.ai)' \
  '' \
  'Co-Authored-By: DeepSeek V4 Pro <noreply@opencode.ai>' \
  > .tmp/commit-msg.txt
```

### 5. Stage and commit

```bash
# Stage specific files (never use git add .)
git add path/to/file1.ts path/to/file2.ts

# Commit using the file
git commit -F .tmp/commit-msg.txt
```

### 6. Clean up

```bash
rm -rf .tmp
```

## Commit Message Format

Follow conventional commits with Linear ticket ID when available:

- `feat(THR-XX):` - New feature
- `fix(THR-XX):` - Bug fix
- `refactor(THR-XX):` - Code restructuring
- `docs(THR-XX):` - Documentation
- `test(THR-XX):` - Tests
- `chore(THR-XX):` - Maintenance

If no Linear ticket exists, omit the parenthetical: `feat: description`

The harness attribution footer is resolved dynamically per section 2 above.

## Common Issues

**Heredoc fails with "can't create temp file":**
This is expected in sandbox mode. Use printf approach instead.

**Sandbox approval for /tmp writes:**
Use `.tmp/` inside the repo (already gitignored) to avoid sandbox prompts.

**Special characters in message:**
Use single quotes to prevent shell expansion. For apostrophes, end the quote, add escaped apostrophe, restart quote:

```bash
printf '%s\n' "Don't do this" > .tmp/commit-msg.txt
```

## Examples

**Simple commit (OpenCode example):**

```bash
mkdir -p .tmp
printf '%s\n' 'fix: correct typo in README' '' '🤖 Generated with [OpenCode](https://opencode.ai)' '' 'Co-Authored-By: DeepSeek V4 Pro <noreply@opencode.ai>' > .tmp/commit-msg.txt
git add README.md && git commit -F .tmp/commit-msg.txt
```

**Multi-line commit (Codex example):**

```bash
mkdir -p .tmp
printf '%s\n' \
  'refactor: extract helper function' \
  '' \
  '- Moved validation logic to separate function' \
  '- Added unit tests' \
  '- Updated callers' \
  '' \
  '🤖 Generated with [Codex](https://github.com/openai/codex)' \
  '' \
  'Co-authored-by: codex <codex@users.noreply.github.com>' \
  > .tmp/commit-msg.txt
git add src/utils.ts src/utils.test.ts && git commit -F .tmp/commit-msg.txt
```
