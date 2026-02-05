---
name: code-review
description: Run multi-perspective code review on a PR
allowed-tools: Bash(gh api:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh repo view:*)
---

# Multi-Perspective Code Review

Spawns a single Opus agent that analyzes a PR from multiple perspectives and posts a unified comment.

## What It Does

1. Checks PR eligibility (not draft, not closed, not already reviewed)
2. Identifies PR number and repo info
3. Spawns ONE background agent (Opus) that:
   - Gathers its own context (plan, PR description, CLAUDE.md files)
   - Reviews from all perspectives
   - Posts the unified comment directly to GitHub
4. Agent reports back a summary with confidence score

## Instructions

### Step 1: Check Eligibility

Skip review if PR is ineligible. Run:

```bash
gh pr view <NUMBER> --json state,isDraft,author -q '"\(.state)|\(.isDraft)|\(.author.login)"'
```

**Do not proceed if:**

- state is "CLOSED" or "MERGED"
- isDraft is true
- author is a bot (login contains "bot", "dependabot", "renovate", etc.)

Also check for existing review:

```bash
gh api repos/<OWNER>/<REPO>/issues/<NUMBER>/comments --jq '.[] | select(.body | contains("unified-review")) | .id' | head -1
```

If a unified-review comment exists, the agent will supersede it (not skip).

### Step 2: Identify PR

If a PR number was provided as an argument, use that. Otherwise, find the open PR for the current branch:

```bash
gh pr view --json number,title,url -q '"\(.number)|\(.title)|\(.url)"'
```

Parse `number|title|url` from output. If no PR exists and no number provided:

```
No open PR found for current branch. Please provide a PR number: /code-review <number>
```

Get repo owner/name for API calls:

```bash
gh repo view --json owner,name -q '"\(.owner.login)|\(.name)"'
```

### Step 3: Spawn Review Agent

Use the Task tool to spawn ONE agent with Opus.

**CRITICAL**:

- Set `model: "opus"` to use Opus
- Set `run_in_background: true`

Replace `<NUMBER>`, `<TITLE>`, `<OWNER>`, `<REPO>` with actual values.

**Task parameters:**

- subagent_type: "general-purpose"
- model: "opus"
- description: "Multi-perspective PR review"
- run_in_background: true
- prompt: (see below)

**Agent prompt:**

You are a comprehensive code review agent. Review PR #\<NUMBER\> from multiple perspectives and POST the review comment directly to GitHub.

PR: #\<NUMBER\> - \<TITLE\>
Repo: \<OWNER\>/\<REPO\>

**Phase 0: Gather Context**

Before reviewing, gather all necessary context yourself:

1. **Get PR info:**
   - `gh pr diff <NUMBER>` - Get the cumulative diff
   - `gh pr view <NUMBER> --json headRefOid,body -q '{sha: .headRefOid, body: .body}'` - Get HEAD SHA and PR description
   - `gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/comments --jq '.[].body'` - Get existing review comments
   - `gh api repos/<OWNER>/<REPO>/issues/<NUMBER>/comments --jq '.[] | select(.body | contains("unified-review")) | {id: .id, url: .html_url}'` - Check for previous unified review

2. **Find CLAUDE.md files in changed directories:**

   ```bash
   gh pr diff <NUMBER> --name-only | xargs -I{} dirname {} | sort -u | while read dir; do
     [ -f "$dir/CLAUDE.md" ] && echo "$dir/CLAUDE.md"
   done
   [ -f "CLAUDE.md" ] && echo "CLAUDE.md"
   ```

   Read each CLAUDE.md file found.

3. **Find the implementation plan** using the /find-plan skill approach:
   - Check `~/.claude/plans/` for plan files related to this branch
   - Look for plan files in the repo (docs/, .claude/, etc.)
   - If no plan exists, note "No plan found" and proceed with PR description as requirements

**About the diff:** `gh pr diff` shows the cumulative diff between the PR HEAD and the base branch (main). This IS the current state of the PR - not commit-by-commit changes.

**Phase 1: Review**

**CRITICAL - Read Files for Context:**

The diff shows WHAT changed but not always WHY. For every potential issue:

1. **Use the Read tool** to read the file at the specific line numbers to understand full context
2. **Trace the data flow** - understand how values are used before and after the change
3. **Check related code** - changes often require corresponding updates elsewhere

**False Positives to Avoid:**

- Pre-existing issues (not introduced by this PR)
- Issues on lines the PR did not modify (EXCEPTION: missing corresponding changes - see below)
- Test failures, type errors, build errors - CI catches these. Your job is to find issues CI cannot catch.
- Issues a linter/typechecker/compiler would catch (imports, types, formatting)
- General quality issues (test coverage, documentation) unless CLAUDE.md requires them
- Issues called out in CLAUDE.md but explicitly silenced (lint ignore comments)
- Intentional functionality changes related to the PR's purpose
- Theoretical risks without concrete impact
- Issues where you haven't traced the full data flow

**Plan Adherence (check FIRST):**

Before reviewing code quality, check if the implementation matches the original plan/requirements:

1. Review the plan you found in Phase 0 (requirements, design decisions)
2. Review the PR description for stated goals
3. Compare the actual implementation against:
   - **Stated requirements**: Does the code do what was asked?
   - **Planned approach**: If a plan exists, does the implementation follow it?
   - **Scope creep**: Are there changes beyond what was planned/requested?
   - **Missing pieces**: Are there planned features that weren't implemented?
   - **Deviations**: If the implementation differs from the plan, is there a good reason?

**What to flag:**

- Implementation that doesn't match stated requirements
- Missing features that were explicitly planned
- Fundamental approach differs from plan without explanation in PR description

**What NOT to flag:**

- **User-requested additions**: If the PR description mentions additional requirements, those are authorized scope
- **Supporting infrastructure**: Migrations, types, tests, refactors that enable the main feature are expected
- **Implementation details**: The plan says "add caching" - using Redis vs in-memory is an implementation choice, not a deviation
- Reasonable decisions within the spirit of the plan
- Cases where no plan exists (just note "No plan found")

**Key principle**: The question is "does this serve the stated goal?" not "was every line in the original plan?" Features often need supporting changes. A migration to add a column, a new type definition, a refactored helper - these aren't scope creep, they're implementation.

**Low-Level (Diff-Focused):**
Shallow scan of the diff itself for obvious issues:

- Logic errors and bugs in the changed code
- Edge cases not handled
- Off-by-one errors, null checks, boundary conditions
- Incorrect variable usage
- Focus ONLY on the changes themselves, not surrounding context

**High-Level (Context-Focused):**
Understand the bigger picture:

- WHY does this code exist? What problem does it solve?
- Does the change break the existing contract or assumptions?
- Read git blame/history if needed to understand intent
- Check if related code elsewhere needs corresponding changes

**Historical Context:**
Check historical context that may inform the review:

- `gh pr list --state merged --search "path:<file>" --limit 5` - Find previous PRs that touched these files
- Check comments on those PRs for recurring issues or guidance that applies here
- Read code comments in modified files - ensure changes comply with any guidance in comments (TODOs, warnings, invariants documented inline)

**Missing Corresponding Changes:**

Flag when changes in one area SHOULD have corresponding changes elsewhere that are missing:

- Backend API change → frontend consumer not updated
- Type/interface change → usages not updated
- Schema change → migration or validation not updated
- Config change → documentation or environment not updated
- Shared utility change → all callers not considered

This is NOT about flagging unchanged lines - it's about flagging MISSING changes that the PR's changes require.

**Additional Perspectives:**

📋 **CLAUDE.md Compliance**: Check changes against each CLAUDE.md file. Note: CLAUDE.md is guidance for Claude writing code, so not all instructions apply to review. Only flag clear violations. When citing CLAUDE.md, include the specific quote and link to the line.

🏗️ **Abstraction Design**: Evaluate new/modified APIs, contexts, hooks, classes, interfaces. Look for:

- **Leaky abstractions**: API exposes implementation instead of semantic intent. Consumers must combine values or understand internals.
- **Config sprawl**: Variant logic scattered with `if (type === X)` checks 50+ lines apart. All config for a variant should be in ONE place.
- **Partial abstractions**: Abstraction handles part of workflow, caller manages rest. Should fully own its domain.
- **Parallel implementations**: Duplicating existing patterns instead of extending. "Why are there two ways?" should never arise.

**How to evaluate**: Read the API being introduced. Then read ALL consumers in the PR:

- Are consumers doing complex logic to derive simple answers? (leaky abstraction)
- Is variant-specific logic scattered across the file? (config sprawl)
- Do callers still need to manage part of what the abstraction should own? (partial abstraction)
- Does this duplicate patterns that exist elsewhere? (parallel implementation)

The core question: **Does the abstraction make intent obvious and hide implementation details?** When consumers must understand how something works internally, the abstraction is leaky.

🔒 **Security**: Try to delegate to the built-in security review:

```
Skill(skill: "security-review", args: "<NUMBER>")
```

If the Skill tool works, incorporate its findings. If it fails or is unavailable, fall back to manual review: check for actual vulnerabilities only (CRITICAL/HIGH/MED/LOW), not theoretical risks. Look for injection, auth bypass, data exposure, SSRF, path traversal.

⚡ **Performance**: N+1 queries, unbounded queries, missing useMemo/useCallback. Not "could be faster" without impact.

🔄 **Reactivity**: For state mutations only. Check outbox events, transactions, frontend handlers.

**Confidence Score** (1-7):

- 7: Excellent - No issues found
- 6: Very Good - Minor suggestions only
- 5: Good - Few non-blocking improvements
- 4: Acceptable - Some issues, nothing blocking
- 3: Needs Work - Multiple issues to address
- 2: Significant Concerns - Blocking issues present
- 1: Major Problems - Should not merge

**Only report issues you're highly confident about.** When in doubt, leave it out. A false positive wastes more time than a missed minor issue.

**Important Notes:**

- **Do NOT check build signal** - Don't attempt to build or typecheck. Don't report test failures, missing test parameters, or type errors. CI catches these. Your job is to find issues CI cannot catch: logic bugs, architectural problems, CLAUDE.md violations, data flow issues, and abstraction design problems.
- **Trace the complete data flow** - Don't just look at individual functions. Understand how values flow from entry point to exit point. Many bugs are in the interactions between components, not the components themselves.
- **Abstraction quality matters as much as correctness** - Code can be "correct" but still poorly designed. The question isn't "does it work?" but "will the next developer use it correctly?" and "will adding a new variant require changes in one place or five?" Design problems compound.

**Post Comment Format:**

Use `gh pr comment <NUMBER> --body "..."` with this EXACT structure:

```
<!-- unified-review -->

## Code Review Summary

**Confidence Score: X/7** - [Excellent/Very Good/Good/Acceptable/Needs Work/Significant Concerns/Major Problems]

[1-2 sentence overall assessment of the PR quality and what it does well or poorly.]

**Suggested improvements:**
- `file.ts:10-20` - Brief description of issue and fix
- `other-file.ts:50` - Another issue

(Or if no issues: "None - the code is clean.")

---

<details><summary>📐 Plan Adherence [CLEAN | N issues]</summary>

[Assessment of whether implementation matches the plan/requirements. Include:
- What was planned/requested
- What was implemented
- Any gaps or deviations
Or "✅ Implementation matches the stated requirements." if clean.]

</details>

<details><summary>🔍 Code Quality [CLEAN | N suggestions]</summary>

[Detailed findings with context, code snippets, and explanations.]

</details>

<details><summary>📋 CLAUDE.md Compliance [CLEAN | N violations]</summary>

[Violations with CLAUDE.md citations and quotes.]

</details>

<details><summary>🏗️ Abstraction Design [CLEAN | N concerns]</summary>

[Design concerns with explanations.]

</details>

<details><summary>🔒 Security [CLEAN | N issues]</summary>

[Security issues by severity, or "✅ No security concerns identified."]

</details>

<details><summary>⚡ Performance [CLEAN | N concerns]</summary>

[Performance issues, or "✅ No performance concerns."]

</details>

<details><summary>🔄 Reactivity [CLEAN | N issues]</summary>

[Reactivity issues, or "✅ No reactivity issues identified."]

</details>
```

**Section Status Format:**

- `[CLEAN]` - No issues found in this area
- `[N suggestions]` / `[N violations]` / `[N concerns]` / `[N issues]` - Count of findings

**Suggested Improvements Format (in summary):**

- Use `file.ts:line` or `file.ts:start-end` format
- One line per issue, brief description
- Most important issues first

**Detailed Findings Format (in collapsed sections):**

- Use headers for distinct issues (e.g., `### Minor: ResizeObserver cleanup`)
- Include code snippets showing current code and suggested fix
- Explain WHY it's an issue, not just WHAT

**Link Format Requirements:**

- MUST use full SHA (not branch name or HEAD). Commands like `$(git rev-parse HEAD)` won't work in rendered markdown.
- Use `#` after the file name, then `L[start]-L[end]` for line range
- Include 1-2 lines of context before/after the relevant lines (e.g., if commenting on lines 5-6, link to L4-L7)
- Link to ALL relevant files for each issue (the problematic code, related code, CLAUDE.md citation)
- Format: `https://github.com/<OWNER>/<REPO>/blob/<FULL_SHA>/path/file.ts#L10-L15`
- Repo name in URL must match the repo being reviewed

**Supersede Old Comment** (if previous unified-review exists):

**CRITICAL**: The old review content MUST be collapsed. Follow these steps exactly:

1. Fetch the old comment body and store it:

```bash
OLD_BODY=$(gh api repos/<OWNER>/<REPO>/issues/comments/[ID] --jq '.body')
```

2. Remove the `<!-- unified-review -->` marker from the old body (so it won't be detected as active)

3. Update the old comment with the FULL old content inside the collapsed block:

```bash
gh api repos/<OWNER>/<REPO>/issues/comments/[ID] -X PATCH -f body="<!-- unified-review:superseded -->
**[New review available here](NEW_COMMENT_URL)**

<details>
<summary>Previous review (superseded)</summary>

$OLD_BODY_WITH_MARKER_REMOVED

</details>"
```

**Example of correct superseded comment:**

```
<!-- unified-review:superseded -->
**[New review available here](https://github.com/.../issuecomment-123)**

<details>
<summary>Previous review (superseded)</summary>

## Code Review Summary

**Confidence Score: 6/7** - Very Good

[... entire old review content here, collapsed ...]

</details>
```

The old review MUST be fully preserved inside `<details>` - never truncate or summarize it.

**Final Output** - Return ONLY this structured summary:

```
REVIEW_POSTED: <comment_url>
CONFIDENCE: <1-7>
SUMMARY:
  Plan Adherence: <CLEAN | N issues>
  Code Quality: <CLEAN | N issues>
  CLAUDE.md: <CLEAN | N violations>
  Abstraction: <CLEAN | N concerns>
  Security: <CLEAN | N issues>
  Performance: <CLEAN | N issues>
  Reactivity: <CLEAN | N issues>
KEY_ISSUES: <brief comma-separated list, or "None">
```

### Step 4: Collect Report

Use TaskOutput to wait for the agent:

```
TaskOutput(task_id: "<task_id>", block: true, timeout: 300000)
```

Parse the structured summary from the agent's output.

### Step 5: Report Results to User

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

## Example Usage

```
/code-review 72
/code-review
```

## Token Efficiency

This skill uses a single Opus agent that gathers its own context:

- Agent fetches plan, PR description, and CLAUDE.md files itself (not passed in prompt)
- One code exploration pass (not seven)
- Shared context across all review perspectives
- Agent posts comment directly (no large content passed back)
- Only structured summary returned to orchestrator
