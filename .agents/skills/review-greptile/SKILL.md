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

### 1. Fetch review data

Run the fetch script to get all Greptile review data as structured JSON:

```bash
bun .agents/skills/review-greptile/fetch-review.ts
# Or with an explicit PR number:
bun .agents/skills/review-greptile/fetch-review.ts --pr 123
```

The script outputs a JSON object with:

- `pr`, `owner`, `repo` — PR identifiers
- `reviewStatus` — Greptile check status (`{ name, status, conclusion }` or `null`)
- `summary` — the latest summary comment with extracted fields:
  - `body` — full comment text
  - `confidenceScore` — e.g. `"3/5"`
  - `fixUrl` — the "Fix with Claude" URL
  - `decodedPrompt` — the URL-decoded prompt content with structured issue details
- `inlineComments` — array of `{ id, path, line, body, created_at }`
- `staleness` — which files were changed after Greptile's review:
  - `lastReviewTimestamp` — when Greptile last commented
  - `filesChangedAfterReview` — files modified in post-review commits

If `reviewStatus.status` is not `"completed"`, the review is still running (~10 minutes). Inform the user and wait before proceeding.

If `summary` is `null`, no Greptile summary comment exists yet.

Use `decodedPrompt` as the primary input for understanding findings — it contains the most structured and actionable version.

### 2. Determine staleness

If `staleness.filesChangedAfterReview` is non-empty, cross-reference with `inlineComments`: any comment whose `path` appears in the changed files list may already be addressed. Read the current code to verify before acting on it.

### 3. Triage

For each issue found in the summary and inline comments, determine its disposition. Tag each row with its **Source** (Summary or Inline) — this determines what response actions are available in step 5:

| # | Source | File:Line | Issue Summary | Disposition | Action |
|---|--------|-----------|---------------|-------------|--------|

Dispositions:

- **Accept** — the issue is valid, fix the code
- **Acknowledge** — the issue is valid but out of scope for this PR
- **Dispute** — the issue is incorrect or conflicts with project rules

Present the triage table to the user and ask for confirmation before proceeding.

**Important:** Greptile is configured with this project's CLAUDE.md rules — its findings reflect project-specific invariants and standards. Disputing should be rare. When you consider disputing, triple-check your reasoning against the relevant invariant or project convention before concluding Greptile is wrong.

### 4. Fix accepted issues

For each accepted issue:

1. Read the relevant code
2. Implement the fix
3. Verify the fix doesn't break tests

Commit and push all fixes together.

### 5. Respond to inline comments

Reply to each **Inline-sourced** thread with the disposition. Use the `respond-to-pr-review` skill's reply mechanics (write to temp file, post via GraphQL, include agent signature).

Resolve threads for **Accept** (fix applied) and **Dispute** (with explanation). Leave **Acknowledge** threads open.

**Summary-only findings** have no inline thread to reply to. For these, Dispute/Acknowledge dispositions are noted in the triage table for the user's awareness but require no thread response — the re-review in step 6 will confirm whether accepted fixes resolved them.

### 6. Wait for re-review

After pushing fixes, Greptile will automatically re-review (~10 minutes). Run the fetch script again to check:

```bash
bun .agents/skills/review-greptile/fetch-review.ts
```

Once `reviewStatus.status` is `"completed"`, compare the new `summary.confidenceScore` against the previous one. Report the before/after score to the user.

## Web Environment

In Claude Code web sessions, the `gh` CLI is not available. Use the `github-api-web` skill for curl-based equivalents. The key endpoints are the same:

- Summary: `GET /repos/{owner}/{repo}/issues/{pr}/comments` filtered by `greptile-apps[bot]`
- Inline: `GET /repos/{owner}/{repo}/pulls/{pr}/comments` filtered by `greptile-apps[bot]`
- Checks: `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`

## Examples

**User says:** "Check Greptile" or "What did Greptile say?"
**Action:** Run fetch script, build triage table from results, present to user

**User says:** "What's the confidence score?"
**Action:** Run fetch script, report `summary.confidenceScore`

**User says:** "Address the Greptile review"
**Action:** Full workflow — fetch, triage, fix accepted issues, respond to all threads, push, wait for re-review

**User shares a Greptile link:** `https://app.greptile.com/ide/claude-code?prompt=...`
**Action:** Decode the prompt parameter to get structured issue details, use as input for triage and fixes
