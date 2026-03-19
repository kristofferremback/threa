---
name: review-greptile
description: Read and triage Greptile code review comments on a PR. Use when asked to "check Greptile", "Greptile review", "what did Greptile say", check confidence score, or when the user shares a Greptile link.
---

# Review Greptile

Systematically read, triage, and address Greptile code review comments on a pull request.

## Greptile Comment Types

Greptile produces two distinct types of comments — they have different lifecycles and must be handled differently:

1. **Summary comment** (issue-level) — posted by `greptile-apps[bot]` on the issues endpoint. **Continuously updated** after every review cycle. Always re-read this; never rely on a cached version. Contains:
   - Confidence score (0-5)
   - Summary of findings
   - Outside-of-diff issues (problems in code not touched by the PR)
   - "Fix with Claude" link — a URL to `https://app.greptile.com/ide/claude-code?prompt=...&repo=...` where the `prompt` param is URL-encoded markdown with file paths, line numbers, issue descriptions, and suggested fixes

2. **Inline code comments** (pull request review comments) — posted by `greptile-apps[bot]` on the pulls endpoint. **One-shot**: written once and not updated. May become stale after fixes are pushed.

## Instructions

### 1. Determine PR number

If not provided, detect from current branch:

```bash
gh pr view --json number -q .number
```

Also extract owner/repo for API calls:

```bash
OWNER=$(gh repo view --json owner -q .owner.login)
REPO=$(gh repo view --json name -q .name)
PR=$(gh pr view --json number -q .number)
```

### 2. Check review status

Greptile reviews take ~10 minutes. Before reading comments, check if the review is complete:

```bash
gh pr checks "$PR" | grep -i greptile
```

If the Greptile Review check is still pending or in progress, inform the user and wait. Reading comments before the review completes will give incomplete results.

### 3. Read the summary comment

Always fetch the latest version — this comment is updated after every review cycle:

```bash
gh api "repos/$OWNER/$REPO/issues/$PR/comments" \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]")] | last'
```

From the summary comment body, extract:

- **Confidence score** — the numerical rating (0-5) reflecting how confident Greptile is in the PR's correctness
- **Issue list** — the categorized findings (bugs, style, performance, etc.)
- **Outside-of-diff issues** — problems in code not modified by the PR but related to the changes
- **"Fix with Claude" link** — decode the `prompt` query parameter to get structured issue details:

```bash
# Extract the Fix with Claude URL from the comment body (stored in $COMMENT_BODY)
FIX_URL=$(echo "$COMMENT_BODY" | grep -o 'https://app\.greptile\.com/ide/claude-code[^)]*' | head -1)
ENCODED_PROMPT=$(echo "$FIX_URL" | sed 's/.*[?&]prompt=\([^&]*\).*/\1/')
python3 -c "import urllib.parse, sys; print(urllib.parse.unquote(sys.argv[1]))" "$ENCODED_PROMPT"
```

Use the decoded prompt content as the primary input for understanding what Greptile found — it contains the most structured and actionable version of the findings.

### 4. Read inline code comments

Fetch all inline review comments from `greptile-apps[bot]`:

```bash
gh api "repos/$OWNER/$REPO/pulls/$PR/comments" \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]") | {id, path, line, body, created_at}]'
```

Cross-reference with recent commits to determine which comments are still relevant:

```bash
# Get the timestamp of Greptile's last inline review comment
GREPTILE_TS=$(gh api "repos/$OWNER/$REPO/pulls/$PR/comments" \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]")] | last | .created_at')

# List files changed only in commits *after* Greptile's review
gh api "repos/$OWNER/$REPO/pulls/$PR/commits" \
  | jq -r --arg ts "$GREPTILE_TS" '[.[] | select(.commit.author.date > $ts)] | .[].sha' \
  | while read sha; do
      gh api "repos/$OWNER/$REPO/commits/$sha" --jq '.files[].filename'
    done | sort -u
```

If a file mentioned in a Greptile comment was modified in a later commit, the comment may already be addressed — read the current code to verify before acting on it.

### 5. Triage

For each issue found in steps 3 and 4, determine its disposition:

| # | Source | File:Line | Issue Summary | Disposition | Action |
|---|--------|-----------|---------------|-------------|--------|

Dispositions:

- **Accept** — the issue is valid, fix the code
- **Acknowledge** — the issue is valid but out of scope for this PR
- **Dispute** — the issue is incorrect or conflicts with project rules

Present the triage table to the user and ask for confirmation before proceeding.

**Important:** Greptile is configured with this project's CLAUDE.md rules — its findings reflect project-specific invariants and standards. Disputing should be rare. When you consider disputing, triple-check your reasoning against the relevant invariant or project convention before concluding Greptile is wrong.

### 6. Fix accepted issues

For each accepted issue:

1. Read the relevant code
2. Implement the fix
3. Verify the fix doesn't break tests

Commit and push all fixes together.

### 7. Respond to inline comments

Reply to each inline thread with the disposition. Use the `respond-to-pr-review` skill's reply mechanics (write to temp file, post via GraphQL, include agent signature).

Resolve threads for **Accept** (fix applied) and **Dispute** (with explanation). Leave **Acknowledge** threads open.

### 8. Wait for re-review

After pushing fixes, Greptile will automatically re-review (~10 minutes). Monitor the check status:

```bash
gh pr checks "$PR" | grep -i greptile
```

Once complete, re-read the summary comment (step 3) to check if the confidence score improved. Report the before/after score to the user.

## Web Environment

In Claude Code web sessions, the `gh` CLI is not available. Use the `github-api-web` skill for curl-based equivalents of all API calls above. The key endpoints are the same:

- Summary: `GET /repos/{owner}/{repo}/issues/{pr}/comments` filtered by `greptile-apps[bot]`
- Inline: `GET /repos/{owner}/{repo}/pulls/{pr}/comments` filtered by `greptile-apps[bot]`
- Checks: `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`

## Examples

**User says:** "Check Greptile" or "What did Greptile say?"
**Action:** Determine PR, check review status, read summary + inline comments, build triage table, present to user

**User says:** "What's the confidence score?"
**Action:** Fetch the summary comment, extract and report the confidence score

**User says:** "Address the Greptile review"
**Action:** Full workflow — read, triage, fix accepted issues, respond to all threads, push, wait for re-review

**User shares a Greptile link:** `https://app.greptile.com/ide/claude-code?prompt=...`
**Action:** Decode the prompt parameter to get structured issue details, use as input for triage and fixes
