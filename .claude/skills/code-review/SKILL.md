---
name: code-review
description: Run parallel multi-perspective code reviews on a PR
---

# Multi-Perspective Code Review

Spawns a single Sonnet 4.5 agent that analyzes a PR from six perspectives and posts a unified comment.

## What It Does

1. Identifies the PR to review (from argument or current branch)
2. Spawns ONE background agent (Sonnet 4.5) that reviews from all perspectives
3. Agent posts the unified comment directly to GitHub
4. Agent reports back a summary with confidence score

## Instructions

### Step 1: Identify and Validate the PR

If a PR number was provided as an argument, use that. Otherwise, find the open PR for the current branch:

```bash
gh pr view --json number,title,url -q '"\(.number)|\(.title)|\(.url)"'
```

Parse `number|title|url` from output. If no PR exists and no number provided:

```
No open PR found for current branch. Please provide a PR number: /code-review <number>
```

Validate PR exists if number was provided:

```bash
gh pr view <NUMBER> --json number -q '.number'
```

Also get repo owner/name for API calls:

```bash
gh repo view --json owner,name -q '"\(.owner.login)|\(.name)"'
```

### Step 2: Spawn Review Agent

Use the Task tool to spawn ONE agent with Sonnet 4.5.

**CRITICAL**:

- Set `model: "sonnet"` to use Sonnet 4.5
- Set `run_in_background: true`

Replace `<NUMBER>`, `<TITLE>`, `<OWNER>`, `<REPO>` with actual values.

````
subagent_type: "general-purpose"
model: "sonnet"
description: "Multi-perspective PR review"
run_in_background: true
prompt: |
  You are a comprehensive code review agent. Review PR #<NUMBER> from multiple perspectives and POST the review comment directly to GitHub.

  PR: #<NUMBER> - <TITLE>
  Repo: <OWNER>/<REPO>

  ## Step 1: Gather Context

  Run these commands to understand the PR:

  ```bash
  # Get the diff
  gh pr diff <NUMBER>

  # Get existing review comments (to avoid repeating addressed feedback)
  gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/comments --jq '.[].body'

  # Check for previous unified review comment
  gh api repos/<OWNER>/<REPO>/issues/<NUMBER>/comments --jq '.[] | select(.body | contains("<!-- unified-review -->")) | {id: .id, url: .html_url}'
````

## Step 2: Multi-Perspective Analysis

Review the PR from ALL of these perspectives:

### 🔍 Code Quality

- Logic errors, bugs, edge cases
- Code clarity and maintainability
- Unaddressed previous review comments

### 🔒 Security

- Actual vulnerabilities (not theoretical risks)
- CRITICAL: Exploitable now, severe impact
- HIGH: Exploitable with conditions
- MED: Limited exploitability
- LOW: Theoretical risk

### 🧪 Testing (Integration/E2E only)

- Focus on `tests/browser/*.spec.ts` and `tests/integration/*.test.ts`
- Flag: `.skip()`, `.todo()`, flaky selectors, deleted tests without replacement
- IGNORE: Missing unit tests, coverage percentages

### ⚡ Performance

- Backend: N+1 queries, unbounded queries, connection leaks
- Frontend: Missing useMemo/useCallback for expensive ops, missing virtualization
- IGNORE: "Could be faster" without measurable impact

### ♿ Accessibility (WCAG 2.1 AA)

- Only for frontend/UI changes
- Flag: Click handlers on divs, missing aria-labels, color as only indicator, missing focus states

### 🔄 Reactivity

- Only for state mutations/real-time features
- Check: Outbox event emitted? In same transaction? Frontend handles event type?

## Step 3: Determine Confidence Score

Rate overall PR quality on a 1-7 scale:

- 7: Excellent - No issues, well-crafted code
- 6: Very Good - Minor suggestions only
- 5: Good - Few small improvements needed
- 4: Acceptable - Some issues but nothing blocking
- 3: Needs Work - Multiple issues that should be addressed
- 2: Significant Concerns - Blocking issues present
- 1: Major Problems - Critical issues, should not merge

## Step 4: Compose and Post Comment

Build this comment structure:

```markdown
<!-- unified-review -->

## Code Review Summary

**Confidence Score: [X]/7** - [One sentence explaining the score]

[If ANY issues exist, list the key ones - max 5 most important:]

**Suggested improvements:**

- `file.ts:123` - [issue]. Suggestion: [solution]
- `file.tsx:45` - [another issue]. Suggestion: [solution]

[If ALL areas are CLEAN:]
✅ No issues found across all review perspectives.

---

<details>
<summary>🔍 Code Quality [CLEAN | X suggestions]</summary>

[Issues or "No issues found"]

**Files reviewed:** [list files]

</details>

<details>
<summary>🔒 Security [CLEAN | X concerns]</summary>

[Issues or "No security concerns found"]

</details>

<details>
<summary>🧪 Testing [CLEAN | X suggestions | N/A]</summary>

[Issues or "No testing issues found" or "No test files in this PR"]

</details>

<details>
<summary>⚡ Performance [CLEAN | X concerns]</summary>

[Issues or "No performance concerns found"]

</details>

<details>
<summary>♿ Accessibility [CLEAN | X concerns | N/A]</summary>

[Issues or "No accessibility issues found" or "No frontend changes"]

</details>

<details>
<summary>🔄 Reactivity [CLEAN | X concerns | N/A]</summary>

[Issues or "No reactivity issues found" or "No real-time features changed"]

</details>
```

Post the comment:

```bash
gh pr comment <NUMBER> --body "[YOUR COMPOSED COMMENT]"
```

Capture the new comment URL from output.

## Step 5: Supersede Old Comment (if exists)

If you found a previous unified-review comment in Step 1:

```bash
gh api repos/<OWNER>/<REPO>/issues/comments/[OLD_COMMENT_ID] -X PATCH -f body="$(cat <<'EOF'
<!-- unified-review:superseded -->
~~This review has been superseded by a newer review.~~

See: [Latest Review](<NEW_COMMENT_URL>)
EOF
)"
```

## Step 6: Report Summary

After posting, output ONLY this structured summary (this is what gets returned to the orchestrator):

```
REVIEW_POSTED: <comment_url>
CONFIDENCE: <1-7>
CODE: <CLEAN | X suggestions>
SECURITY: <CLEAN | X concerns>
TESTING: <CLEAN | X suggestions | N/A>
PERFORMANCE: <CLEAN | X concerns>
ACCESSIBILITY: <CLEAN | X concerns | N/A>
REACTIVITY: <CLEAN | X concerns | N/A>
KEY_ISSUES: <comma-separated list of top 3 issues, or "None">
```

This summary is your final output. Do not include anything else after it.

```

### Step 3: Collect Report

Use TaskOutput to wait for the agent:

```

TaskOutput(task_id: "<task_id>", block: true, timeout: 300000)

```

Parse the structured summary from the agent's output.

### Step 4: Report Results to User

```

Code review posted to PR #<NUMBER>: <COMMENT_URL>

Confidence: <SCORE>/7

- Code: [status]
- Security: [status]
- Testing: [status]
- Performance: [status]
- Accessibility: [status]
- Reactivity: [status]

[If KEY_ISSUES is not "None":]
Key issues: [list them]

```

## Example Usage

```

/code-review 72
/code-review

```

## Token Efficiency

This skill uses a single Sonnet 4.5 agent instead of six parallel agents:
- One code exploration pass (not six)
- Shared context across all review perspectives
- Agent posts comment directly (no large content passed back)
- Only structured summary returned to orchestrator
```
