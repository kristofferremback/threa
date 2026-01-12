---
name: code-review
description: Run parallel multi-perspective code reviews on a PR
---

# Parallel Code Review

Orchestrates multiple parallel review agents that analyze a PR from different perspectives, then posts a single unified comment.

## What It Does

1. Identifies the PR to review (from argument or current branch)
2. Spawns six background agents in parallel
3. Collects all agent reports
4. Posts ONE unified comment with highlights and collapsible details per reviewer

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

### Step 2: Check for Previous Review

Find your previous unified comment (if any):

```bash
gh api repos/<OWNER>/<REPO>/issues/<NUMBER>/comments --jq '.[] | select(.body | contains("<!-- unified-review -->")) | {id: .id}'
```

Save the comment ID if found.

### Step 3: Spawn All Review Agents

Use the Task tool to spawn SIX agents in parallel. All calls in the SAME message.

**CRITICAL**: Set `run_in_background: true` for all agents.

Replace `<NUMBER>`, `<TITLE>`, `<OWNER>`, `<REPO>` with actual values.

---

**Agent 1 - Code Review:**

```
subagent_type: "general-purpose"
description: "Code review PR"
run_in_background: true
prompt: |
  You are a code review agent. Analyze and REPORT BACK (do not post to GitHub).

  PR: #<NUMBER> - <TITLE>
  Repo: <OWNER>/<REPO>

  ## Step 1: Get Context

  1. Get existing PR review comments:
     gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/comments --jq '.[].body'

  2. Run: /review <NUMBER>

  ## Step 2: Analyze

  Look for:
  - Logic errors, bugs, edge cases
  - Code quality issues
  - Unaddressed previous review comments

  ## Step 3: Report

  Output your findings in this EXACT format (this is your final output, not a GitHub comment):

```

STATUS: [CLEAN | SUGGESTIONS]
ISSUES:

- `file.ts:123` - [issue]. Suggestion: [solution]
- `file.ts:456` - [issue]. Suggestion: [solution]
  FILES:
- file1.ts
- file2.ts
- file3.ts
  UNADDRESSED: [list any unaddressed previous comments, or "None"]

```

If no issues: STATUS: CLEAN, ISSUES: None

## Severity Guide
Focus on real problems. Skip style nits unless egregious.

Report your findings. Do NOT post to GitHub.
```

---

**Agent 2 - Security Review:**

````
subagent_type: "general-purpose"
description: "Security review PR"
run_in_background: true
prompt: |
  You are a security review agent. Analyze and REPORT BACK (do not post to GitHub).

  PR: #<NUMBER> - <TITLE>
  Repo: <OWNER>/<REPO>

  ## Step 1: Analyze

  ```bash
  gh pr diff <NUMBER>
````

Look for actual vulnerabilities, not theoretical risks.

## Step 2: Report

Output your findings in this EXACT format:

```
STATUS: [CLEAN | CONCERNS]
ISSUES:
- [CRITICAL|HIGH|MED|LOW] `file.ts:123` - [vulnerability]. Suggestion: [solution]
SCOPE: [what you checked]
```

If no issues: STATUS: CLEAN, ISSUES: None

## What Counts

- CRITICAL: Exploitable now, severe impact
- HIGH: Exploitable with conditions
- MED: Limited exploitability
- LOW: Theoretical risk

Report your findings. Do NOT post to GitHub.

```

---

**Agent 3 - Testing Review:**

```

subagent_type: "general-purpose"
description: "Testing review PR"
run_in_background: true
prompt: |
You are a testing review agent. Focus on INTEGRATION and E2E/BROWSER tests.
Analyze and REPORT BACK (do not post to GitHub).

PR: #<NUMBER> - <TITLE>
Repo: <OWNER>/<REPO>

## Philosophy

Unit tests have low ROI except for tricky logic. Integration tests and browser tests catch real bugs.
Do NOT flag missing unit tests. DO flag issues in integration/e2e tests.

## Step 1: Analyze

```bash
gh pr diff <NUMBER>
```

Focus on:

- `tests/browser/*.spec.ts` (Playwright e2e tests)
- `tests/integration/*.test.ts` (integration tests)
- `*.test.ts` files that mount real components or hit real APIs

Ignore: Pure unit tests that mock everything.

## Step 2: Report

Output your findings in this EXACT format:

```
STATUS: [CLEAN | SUGGESTIONS]
ISSUES:
- `file.spec.ts:123` - [issue]. Suggestion: [solution]
FILES:
- file1.spec.ts
- file2.test.ts
```

If no issues: STATUS: CLEAN, ISSUES: None

## What to Flag

- `.skip()` or `.todo()` in any test
- Browser test doesn't simulate real user behavior
- Flaky selectors (fragile CSS, missing data-testid)
- Deleted integration/e2e tests without replacement

## What to IGNORE

- Missing unit tests
- Unit test coverage percentages

Report your findings. Do NOT post to GitHub.

```

---

**Agent 4 - Performance Review:**

```

subagent_type: "general-purpose"
description: "Performance review PR"
run_in_background: true
prompt: |
You are a performance review agent. Flag ONLY real bottlenecks.
Analyze and REPORT BACK (do not post to GitHub).

PR: #<NUMBER> - <TITLE>
Repo: <OWNER>/<REPO>

## Step 1: Analyze

```bash
gh pr diff <NUMBER>
```

## Step 2: Report

Output your findings in this EXACT format:

```
STATUS: [CLEAN | CONCERNS]
ISSUES:
- [HIGH|MED|LOW] `file.ts:123` - [bottleneck]. Suggestion: [solution]
SCOPE: [what you checked]
```

If no issues: STATUS: CLEAN, ISSUES: None

## Backend Red Flags

- N+1 queries (SELECT in loop)
- Unbounded queries (no LIMIT)
- Holding connections during async work

## Frontend Red Flags

- Missing useMemo/useCallback for expensive ops
- Object literals in useEffect deps
- Missing virtualization for long lists

## What to IGNORE

- "Could be faster" without measurable impact

Report your findings. Do NOT post to GitHub.

```

---

**Agent 5 - Accessibility Review:**

```

subagent_type: "general-purpose"
description: "Accessibility review PR"
run_in_background: true
prompt: |
You are an accessibility review agent. Focus on EU Accessibility Act / WCAG 2.1 AA.
Analyze and REPORT BACK (do not post to GitHub).

PR: #<NUMBER> - <TITLE>
Repo: <OWNER>/<REPO>

## Step 1: Analyze

```bash
gh pr diff <NUMBER>
```

Only review frontend/UI changes.

## Step 2: Report

Output your findings in this EXACT format:

```
STATUS: [CLEAN | CONCERNS | N/A]
ISSUES:
- [CRITICAL|HIGH|MED] `file.tsx:123` WCAG [X.X.X] - [issue]. Suggestion: [solution]
SCOPE: [what you checked]
```

If no frontend changes: STATUS: N/A
If no issues: STATUS: CLEAN, ISSUES: None

## Common Issues

- Click handlers on divs (use button)
- Missing aria-label on icon buttons
- Color as only indicator
- Missing focus indicators

Report your findings. Do NOT post to GitHub.

```

---

**Agent 6 - Reactivity Review:**

```

subagent_type: "general-purpose"
description: "Reactivity review PR"
run_in_background: true
prompt: |
You are a reactivity review agent. Verify real-time updates work correctly.
Analyze and REPORT BACK (do not post to GitHub).

PR: #<NUMBER> - <TITLE>
Repo: <OWNER>/<REPO>

## Step 1: Analyze

```bash
gh pr diff <NUMBER>
```

Look for state mutations and real-time features.

## Step 2: Report

Output your findings in this EXACT format:

```
STATUS: [CLEAN | CONCERNS | N/A]
ISSUES:
- [HIGH|MED|LOW] `file.ts:123` - [issue]. Expected: [correct behavior]
SCOPE: [what you checked]
```

If no real-time changes: STATUS: N/A
If no issues: STATUS: CLEAN, ISSUES: None

## Pattern Check (for mutations)

1. Does it emit an outbox event?
2. Is event in same transaction as state change?
3. Does frontend handle this event type?

Report your findings. Do NOT post to GitHub.

```

---

### Step 4: Collect All Reports

Use TaskOutput to wait for each agent:

```

TaskOutput(task_id: "<task_id>", block: true, timeout: 300000)

````

Parse each agent's STATUS and ISSUES from their output.

### Step 5: Compose Unified Comment

Build a single comment with this structure:

```markdown
<!-- unified-review -->
## Code Review Summary

[If ANY agent has issues, list the key ones here - max 5 most important:]

**Suggested improvements:**
- `file.ts:123` - [issue from any reviewer]. Suggestion: [solution]
- `file.tsx:45` - [another issue]. Suggestion: [solution]

[If ALL agents are CLEAN:]
✅ No issues found across all review perspectives.

---

<details>
<summary>🔍 Code Review [CLEAN | SUGGESTIONS]</summary>

[If issues:]
- `file.ts:123` - [issue]. Suggestion: [solution]

**Files reviewed:**
- file1.ts
- file2.ts
- file3.ts

</details>

<details>
<summary>🔒 Security [CLEAN | CONCERNS]</summary>

[Agent 2's full report]

</details>

<details>
<summary>🧪 Testing [CLEAN | SUGGESTIONS | N/A]</summary>

[If issues:]
- `file.spec.ts:123` - [issue]. Suggestion: [solution]

**Files reviewed:**
- file1.spec.ts
- file2.test.ts

</details>

<details>
<summary>⚡ Performance [CLEAN | CONCERNS]</summary>

[Agent 4's full report]

</details>

<details>
<summary>♿ Accessibility [CLEAN | CONCERNS | N/A]</summary>

[Agent 5's full report]

</details>

<details>
<summary>🔄 Reactivity [CLEAN | CONCERNS | N/A]</summary>

[Agent 6's full report]

</details>
````

### Step 6: Post New Comment

Always post a fresh comment:

```bash
gh pr comment <NUMBER> --body "[UNIFIED COMMENT CONTENT]"
```

Capture the new comment's URL from the output.

### Step 7: Supersede Old Comment (if exists)

If you found a previous comment in Step 2, update it to a minimal stub:

```bash
gh api repos/<OWNER>/<REPO>/issues/comments/[OLD_COMMENT_ID] -X PATCH -f body="$(cat <<'EOF'
<!-- unified-review:superseded -->
~~This review has been superseded by a newer review.~~

See: [Latest Review](<NEW_COMMENT_URL>)
EOF
)"
```

This keeps history but minimizes clutter.

### Step 8: Report Results

```
Code review posted to PR #<NUMBER>: <PR_URL>

Summary:
- Code: [CLEAN | X suggestions]
- Security: [CLEAN | X concerns]
- Testing: [CLEAN | X suggestions | N/A]
- Performance: [CLEAN | X concerns]
- Accessibility: [CLEAN | X concerns | N/A]
- Reactivity: [CLEAN | X concerns | N/A]
```

## Example Usage

```
/code-review 72
/code-review
```

## Notes

- Fresh comment each run; old comments superseded with link to new
- Highlights surfaced at top, details collapsible
- Files listed as bullet points inside details blocks
- Soft language: "suggestions" not "request changes"
- Agents report to orchestrator, orchestrator posts
