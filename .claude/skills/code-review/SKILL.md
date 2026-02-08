---
name: code-review
description: Run multi-perspective code review on a PR
allowed-tools: Bash(gh api:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh repo view:*)
---

# Multi-Perspective Code Review

Spawns parallel review agents with confidence-based scoring to filter false positives.

## Architecture

- **Orchestrator** (you): eligibility, context gathering, coordination, posting
- **Sonnet agents** (6 parallel, background): focused review, one perspective each
- **Haiku agents** (N parallel): independent confidence scoring per issue
- **Threshold**: only issues scoring >= 80/100 survive to the final comment

## Instructions

### Step 1: Check Eligibility

```bash
gh pr view <NUMBER> --json state,isDraft,author -q '"\(.state)|\(.isDraft)|\(.author.login)"'
```

**Do not proceed if:**

- state is "CLOSED" or "MERGED"
- isDraft is true
- author is a bot (login contains "bot", "dependabot", "renovate", etc.)

Also check for existing **active** review comments (not already superseded):

```bash
gh api repos/<OWNER>/<REPO>/issues/<NUMBER>/comments --jq '[.[] | select(.body | contains("unified-review")) | select(.body | contains("unified-review:superseded") | not) | .id]'
```

If any active unified-review comments exist, note ALL their IDs — the review will supersede each one (not skip).

### Step 2: Identify PR

If a PR number was provided as an argument, use that. Otherwise:

```bash
gh pr view --json number,title,url -q '"\(.number)|\(.title)|\(.url)"'
```

If no PR exists and no number provided:

```
No open PR found for current branch. Please provide a PR number: /code-review <number>
```

Get repo info:

```bash
gh repo view --json owner,name -q '"\(.owner.login)|\(.name)"'
```

### Step 3: Gather Context

The orchestrator gathers context directly (no agents needed for this).

1. **Get PR info:**

```bash
gh pr view <NUMBER> --json headRefOid,body -q '{sha: .headRefOid, body: .body}'
```

2. **Find and read CLAUDE.md files:**

```bash
gh pr diff <NUMBER> --name-only | xargs -I{} dirname {} | sort -u | while read dir; do
  [ -f "$dir/CLAUDE.md" ] && echo "$dir/CLAUDE.md"
done
[ -f "CLAUDE.md" ] && echo "CLAUDE.md"
```

Read each CLAUDE.md file found.

3. **Find the implementation plan** — spawn a background Task agent (`model: "haiku"`, `subagent_type: "general-purpose"`, `run_in_background: true`):

> Find the implementation plan for the current feature branch. Follow these steps:
>
> 1. Determine the Claude projects directory:
>
> ```bash
> PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
> CLAUDE_PATH=$(echo "$PROJECT_ROOT" | sed 's/[\/.]/-/g')
> PROJECTS_DIR="$HOME/.claude/projects/$CLAUDE_PATH"
> ```
>
> 2. Check for plan files written during sessions:
>
> ```bash
> SESSIONS_INDEX="$PROJECTS_DIR/sessions-index.json"
> for jsonl in "$PROJECTS_DIR"/*.jsonl; do
>   [ -f "$jsonl" ] || continue
>   PLAN_FILES=$(grep -o '"file_path":"[^"]*"' "$jsonl" 2>/dev/null | \
>     grep -iE 'plan|task|design' | \
>     sed 's/"file_path":"//g' | sed 's/"//g' | sort -u)
>   [ -n "$PLAN_FILES" ] && echo "$PLAN_FILES"
> done
> ```
>
> 3. Check for plan files in the repository:
>
> ```bash
> find . -maxdepth 4 -type f \( \
>   -name "*.plan.md" -o -name "plan.md" -o \
>   -path "*/plans/*.md" -o -path "*/.claude/plans/*.md" \
> \) 2>/dev/null
> ```
>
> 4. Check `~/.claude/plans/` for plan files related to this branch
> 5. If plan files were found, read and combine them chronologically. If multiple plans exist (main + substep), present them with hierarchy.
> 6. If NO plan files were found, return: "No plan found"
>
> Return the combined plan content in markdown format.

This agent runs in the background while you proceed with reading CLAUDE.md files. Collect its result before Step 4.

Store the HEAD SHA, PR description, CLAUDE.md content, and plan content for passing to agents.

### Step 4: Spawn Review Agents

Spawn **6 parallel Sonnet agents** (all with `run_in_background: true`). Each agent returns a list of issues.

**CRITICAL for all agents:**

- `model: "sonnet"`, `subagent_type: "general-purpose"`, `run_in_background: true`
- Each agent receives the CLAUDE.md content and PR summary you gathered in Step 3
- Do NOT check build signal or attempt to build/typecheck

**Issue return format** (all agents must use this):

```
ISSUES:
- file.ts:10-20 | CATEGORY | Description of the issue and why it matters
- other-file.ts:50 | CATEGORY | Description
```

Categories: `claude-md`, `bug`, `historical`, `plan`, `missing-change`, `abstraction`, `security`, `performance`, `reactivity`

If no issues: `ISSUES: none`

---

**Agent 1: CLAUDE.md Compliance**

> You are a CLAUDE.md compliance auditor. Review PR #\<NUMBER\> in \<OWNER\>/\<REPO\>.
>
> CLAUDE.md files and their contents:
> \<CLAUDE_MD_CONTENT\>
>
> PR Summary: \<PR_SUMMARY\>
>
> Steps:
>
> 1. Run `gh pr diff <NUMBER>` to get the full diff
> 2. For each CLAUDE.md instruction (especially project invariants), check if any change in the diff violates it
> 3. For each potential violation, use the Read tool to read the actual file and confirm the issue exists in context
> 4. You MUST cite the specific CLAUDE.md instruction being violated — quote it and include the invariant ID if applicable
>
> Note: CLAUDE.md is guidance for Claude writing code. Not all instructions apply during review. Only flag CLEAR violations where the diff introduces code that contradicts a specific instruction.
>
> Do NOT flag:
>
> - Issues explicitly silenced in code (lint ignore comments)
> - Pre-existing issues not introduced by this PR
> - Issues a linter/typechecker/compiler would catch
> - General quality issues unless CLAUDE.md explicitly requires them
> - Stylistic preferences not explicitly called out in CLAUDE.md
>
> Return format:
>
> ```
> ISSUES:
> - file.ts:10-20 | claude-md | Violates INV-XX: "<quoted instruction>" — <explanation>
> ```

---

**Agent 2: Bug Scan (Diff-Focused)**

> You are a bug detector. Shallow scan PR #\<NUMBER\> in \<OWNER\>/\<REPO\> for obvious bugs.
>
> PR Summary: \<PR_SUMMARY\>
>
> Steps:
>
> 1. Run `gh pr diff <NUMBER>` to get the full diff
> 2. Scan for: logic errors, unhandled edge cases, off-by-one errors, null/undefined hazards, incorrect variable usage, race conditions
> 3. Focus ONLY on the changes themselves
> 4. Focus on LARGE bugs — avoid nitpicks
> 5. If you're not confident it's a bug, skip it
>
> Do NOT flag: linter/typechecker issues, test failures, pre-existing issues, pedantic nitpicks.

---

**Agent 3: Historical Context**

> You are a historical context reviewer for PR #\<NUMBER\> in \<OWNER\>/\<REPO\>.
>
> PR Summary: \<PR_SUMMARY\>
>
> Steps:
>
> 1. Run `gh pr diff <NUMBER> --name-only` to get modified files
> 2. For each modified file:
>    - `gh pr list --state merged --search "path:<file>" --limit 5` — find previous PRs
>    - Check comments on those PRs for recurring issues or guidance
>    - Read the file to check code comments (TODOs, warnings, invariants)
> 3. Flag changes that violate guidance found in code comments, previous PR feedback, or established patterns

---

**Agent 4: Plan Adherence & Completeness**

> You are reviewing PR #\<NUMBER\> in \<OWNER\>/\<REPO\> for plan adherence and completeness.
>
> PR Summary: \<PR_SUMMARY\>
> Plan: \<PLAN_CONTENT or "No plan found"\>
>
> Steps:
>
> 1. Run `gh pr diff <NUMBER>` to get the full diff
> 2. Compare implementation against plan/PR description:
>    - Does the code do what was asked?
>    - Are there planned features that weren't implemented?
>    - Does the approach match the plan?
> 3. Check for MISSING corresponding changes:
>    - Backend API change → frontend consumer not updated?
>    - Type/interface change → usages not updated?
>    - Schema change → migration or validation not updated?
>    - Shared utility change → all callers not considered?
> 4. Use the Read tool to verify each finding — trace the data flow
>
> Do NOT flag: supporting infrastructure (migrations, types, tests), implementation detail choices, user-requested additions in PR description.

---

**Agent 5: Design & Non-Functional Concerns**

> You are reviewing PR #\<NUMBER\> in \<OWNER\>/\<REPO\> for design quality and non-functional concerns.
>
> CLAUDE.md files: \<CLAUDE_MD_CONTENT\>
> PR Summary: \<PR_SUMMARY\>
>
> Steps:
>
> 1. Run `gh pr diff <NUMBER>` and read modified files for full context
> 2. Check each area — flag concrete issues only, not theoretical risks:
>
> **Abstraction Design:**
>
> - Leaky abstractions (API exposes implementation details)
> - Config sprawl (variant logic scattered across file)
> - Partial abstractions (caller still manages part of the workflow)
> - Parallel implementations (duplicating existing patterns)
>
> **Performance:** N+1 queries, unbounded queries, missing memoization with measurable impact
>
> **Reactivity:** Outbox events, transactions, frontend state handlers

---

**Agent 6: Security Review**

> You are a senior security engineer reviewing PR #\<NUMBER\> in \<OWNER\>/\<REPO\>. Focus ONLY on HIGH-CONFIDENCE security vulnerabilities with real exploitation potential. This is not a general code review — focus ONLY on security implications newly introduced by this PR.
>
> PR Summary: \<PR_SUMMARY\>
>
> Steps:
>
> 1. Run `gh pr diff <NUMBER>` to get the full diff
> 2. Use Read, Glob, and Grep to understand the codebase's existing security patterns (sanitization, validation, auth frameworks)
> 3. Trace data flow from user inputs to sensitive operations in the changed code
> 4. Only flag issues where you're >80% confident of actual exploitability
>
> **Categories to examine:**
>
> - Input validation: SQL injection, command injection, XXE, template injection, path traversal
> - Auth & authorization: bypass logic, privilege escalation, session flaws, JWT vulnerabilities
> - Crypto & secrets: hardcoded keys/tokens, weak algorithms, improper key storage
> - Injection & code execution: deserialization RCE, eval injection, XSS (reflected, stored, DOM-based)
> - Data exposure: sensitive data logging, PII handling violations, API endpoint leakage
>
> **Hard exclusions — do NOT report:**
>
> - Denial of Service, resource exhaustion, rate limiting concerns
> - Secrets stored on disk (handled separately)
> - Race conditions unless concretely problematic with a specific attack path
> - Outdated third-party library vulnerabilities
> - Memory safety issues in memory-safe languages
> - Issues only in test files
> - Log spoofing (logging unsanitized user input is not a vulnerability)
> - SSRF that only controls path (only if it controls host or protocol)
> - User-controlled content in AI system prompts
> - Regex injection or regex DoS
> - Issues in documentation/markdown files
> - Lack of audit logs
> - Lack of hardening measures without a concrete vulnerability
> - Input validation concerns on non-security-critical fields without proven impact
>
> **Precedents — calibrate your findings:**
>
> - Logging high-value secrets in plaintext IS a vulnerability. Logging URLs is safe.
> - UUIDs are unguessable — no need to validate.
> - Environment variables and CLI flags are trusted. Attacks requiring control of env vars are invalid.
> - Resource management issues (memory/FD leaks) are not security vulnerabilities.
> - React/Angular are secure against XSS unless using dangerouslySetInnerHTML or bypassSecurityTrustHtml. Do NOT report XSS in tsx files without unsafe methods.
> - Client-side JS/TS permission checks are not vulnerabilities — the backend handles auth.
> - Only include MEDIUM findings if they are obvious and concrete.
>
> **Severity:**
>
> - HIGH: Directly exploitable — RCE, data breach, auth bypass
> - MEDIUM: Requires specific conditions but significant impact
> - LOW: Defense-in-depth (but only report if concrete)
>
> Return format:
>
> ```
> ISSUES:
> - file.ts:10-20 | security | [HIGH/MED/LOW] Description with exploit scenario
> ```

---

### Step 5: Confidence Scoring

Collect all issues from the 6 review agents (via TaskOutput). For each issue, spawn a **parallel Haiku agent** to score it independently.

`model: "haiku"`, `subagent_type: "general-purpose"`

Pass each scoring agent: the issue description, the CLAUDE.md content, and the PR number.

> You are a code review confidence scorer. Score this issue on a scale from 0-100.
>
> PR: #\<NUMBER\> in \<OWNER\>/\<REPO\>
> Issue: \<ISSUE_DESCRIPTION\>
> CLAUDE.md files: \<CLAUDE_MD_CONTENT\>
>
> Run `gh pr diff <NUMBER>` to verify the issue against the actual diff.
>
> Scoring rubric:
>
> - **0**: False positive. Doesn't stand up to scrutiny, or is a pre-existing issue.
> - **25**: Might be real, but could be a false positive. If stylistic, not explicitly called out in CLAUDE.md.
> - **50**: Real issue, but a nitpick or rare in practice. Not very important relative to the rest of the PR.
> - **75**: Very likely a real issue that will be hit in practice. The existing approach is insufficient. Important and will directly impact functionality, OR directly mentioned in CLAUDE.md.
> - **100**: Definitely a real issue, will happen frequently. Evidence directly confirms it.
>
> **For CLAUDE.md issues specifically:** Double check that the CLAUDE.md actually calls out this issue. If the cited instruction doesn't exist or doesn't say what was claimed, score 25 or lower.
>
> Return ONLY: `SCORE: <number>`

**Filter:** Remove any issues scoring below 80.

### Step 6: Compose Comment

Compute an overall confidence score (1-7):

- 7: Excellent — No issues survived filtering
- 6: Very Good — Minor suggestions only
- 5: Good — Few non-blocking improvements
- 4: Acceptable — Some issues, nothing blocking
- 3: Needs Work — Multiple issues to address
- 2: Significant Concerns — Blocking issues present
- 1: Major Problems — Should not merge

### Step 7: Re-Check Eligibility

Re-run the eligibility check from Step 1 to ensure the PR hasn't been closed or converted to draft during the review.

### Step 8: Post Comment

**If issues were found**, use `gh pr comment <NUMBER> --body "..."`:

```
<!-- unified-review -->

### Code review

**Confidence: X/7** — [Excellent/Very Good/Good/Acceptable/Needs Work/Significant Concerns/Major Problems]

Found N issues:

1. `file.ts:10-20` — Brief description (CLAUDE.md says "<quoted instruction>" | bug due to <reason> | etc.)

   https://github.com/<OWNER>/<REPO>/blob/<FULL_SHA>/path/file.ts#L9-L21

2. `other-file.ts:50` — Brief description

   https://github.com/<OWNER>/<REPO>/blob/<FULL_SHA>/path/other-file.ts#L49-L52

---

<details><summary>📐 Plan Adherence [CLEAN | N issues]</summary>

[Assessment or "✅ Implementation matches the stated requirements."]

</details>

<details><summary>🔍 Code Quality [CLEAN | N issues]</summary>

[Bug findings or "✅ No bugs found."]

</details>

<details><summary>📋 CLAUDE.md Compliance [CLEAN | N violations]</summary>

[Violations with citations and quotes, or "✅ No CLAUDE.md violations."]

</details>

<details><summary>🏗️ Abstraction Design [CLEAN | N concerns]</summary>

[Design concerns or "✅ No design concerns."]

</details>

<details><summary>🔒 Security [CLEAN | N issues]</summary>

[Security issues or "✅ No security concerns identified."]

</details>

<details><summary>⚡ Performance [CLEAN | N concerns]</summary>

[Performance issues or "✅ No performance concerns."]

</details>

<details><summary>🔄 Reactivity [CLEAN | N issues]</summary>

[Reactivity issues or "✅ No reactivity issues identified."]

</details>

🤖 Generated with [Claude Code](https://claude.ai/code)

<sub>If this review was useful, react with 👍. Otherwise, react with 👎.</sub>
```

**If no issues survived filtering:**

```
<!-- unified-review -->

### Code review

**Confidence: 7/7** — Excellent

No issues found. Checked for bugs, CLAUDE.md compliance, plan adherence, design quality, security, and performance.

🤖 Generated with [Claude Code](https://claude.ai/code)

<sub>If this review was useful, react with 👍. Otherwise, react with 👎.</sub>
```

**Link Format Requirements:**

- MUST use full SHA (not branch name or HEAD). `$(git rev-parse HEAD)` won't work in rendered markdown.
- `#` after the file name, then `L[start]-L[end]` for line range
- Include 1-2 lines of context before/after the relevant lines
- Link to ALL relevant files for each issue
- For CLAUDE.md citations, link to the specific line in CLAUDE.md
- Format: `https://github.com/<OWNER>/<REPO>/blob/<FULL_SHA>/path/file.ts#L10-L15`

**Supersede Old Comments** (if ANY active unified-review comments found in Step 1):

For EACH old comment ID, supersede it:

1. Fetch the old comment body:

```bash
OLD_BODY=$(gh api repos/<OWNER>/<REPO>/issues/comments/[ID] --jq '.body')
```

2. Remove the `<!-- unified-review -->` marker from the old body (replace with `<!-- unified-review:old -->`)

3. Update the old comment with full content collapsed:

```bash
gh api repos/<OWNER>/<REPO>/issues/comments/[ID] -X PATCH -f body="<!-- unified-review:superseded -->
**[New review available here](NEW_COMMENT_URL)**

<details>
<summary>Previous review (superseded)</summary>

$OLD_BODY_WITH_MARKER_REMOVED

</details>"
```

**IMPORTANT:** Supersede ALL active comments, not just the first one. Multiple active reviews can exist from previous runs that failed to supersede properly. Each old review MUST be fully preserved inside `<details>` — never truncate or summarize it.

### Step 9: Report to User

```
Code review posted to PR #<NUMBER>: <COMMENT_URL>

Confidence: <SCORE>/7

Summary:
- 📐 Plan Adherence: <status>
- 🔍 Code Quality: <status>
- 📋 CLAUDE.md: <status>
- 🏗️ Abstraction: <status>
- 🔒 Security: <status>
- ⚡ Performance: <status>
- 🔄 Reactivity: <status>

Key issues: [list if any]
```

## False Positives (shared guidance for ALL review agents)

- Pre-existing issues (not introduced by this PR)
- Issues on lines the PR did not modify (EXCEPTION: missing corresponding changes)
- Test failures, type errors, build errors — CI catches these
- Issues a linter/typechecker/compiler would catch
- General quality issues unless CLAUDE.md explicitly requires them
- Issues called out in CLAUDE.md but explicitly silenced in code
- Intentional functionality changes related to the PR's purpose
- Theoretical risks without concrete impact
- Pedantic nitpicks a senior engineer wouldn't call out

## Example Usage

```
/code-review 72
/code-review
```
