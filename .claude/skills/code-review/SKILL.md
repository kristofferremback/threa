---
name: code-review
description: Run multi-perspective code review on a PR
allowed-tools: Bash(gh api:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh repo view:*)
---

# Multi-Perspective Code Review

Spawns a single Sonnet agent that analyzes a PR from multiple perspectives and posts a unified comment.

## What It Does

1. Checks PR eligibility (not draft, not closed, not already reviewed)
2. Gathers CLAUDE.md context for compliance checking
3. Spawns ONE background agent (Sonnet) that reviews from all perspectives
4. Agent posts the unified comment directly to GitHub
5. Agent reports back a summary with confidence score

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

### Step 2: Identify PR and Gather Context

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

Find relevant CLAUDE.md files:

```bash
gh pr diff <NUMBER> --name-only | xargs -I{} dirname {} | sort -u | while read dir; do
  [ -f "$dir/CLAUDE.md" ] && echo "$dir/CLAUDE.md"
done
[ -f "CLAUDE.md" ] && echo "CLAUDE.md"
```

### Step 3: Spawn Review Agent

Use the Task tool to spawn ONE agent with Sonnet.

**CRITICAL**:

- Set `model: "sonnet"` to use Sonnet
- Set `run_in_background: true`

Replace `<NUMBER>`, `<TITLE>`, `<OWNER>`, `<REPO>`, `<CLAUDE_MD_FILES>` with actual values.

**Task parameters:**

- subagent_type: "general-purpose"
- model: "sonnet"
- description: "Multi-perspective PR review"
- run_in_background: true
- prompt: (see below)

**Agent prompt:**

You are a comprehensive code review agent. Review PR #\<NUMBER\> from multiple perspectives and POST the review comment directly to GitHub.

PR: #\<NUMBER\> - \<TITLE\>
Repo: \<OWNER\>/\<REPO\>
CLAUDE.md files to check: \<CLAUDE_MD_FILES\>

**Gather Context** - Run these commands:

- `gh pr diff <NUMBER>` - Get the diff (WARNING: shows ALL changes, some may be outdated if fixed in later commits)
- `gh pr view <NUMBER> --json headRefOid -q '.headRefOid'` - Get HEAD SHA for linking
- `gh pr view <NUMBER> --json commits -q '.commits | length'` - Check number of commits (if >1, issues may have been fixed)
- `gh api repos/<OWNER>/<REPO>/pulls/<NUMBER>/comments --jq '.[].body'` - Get existing review comments
- `gh api repos/<OWNER>/<REPO>/issues/<NUMBER>/comments --jq '.[] | select(.body | contains("unified-review")) | {id: .id, url: .html_url}'` - Check for previous unified review
- Read each CLAUDE.md file listed above

**WARNING**: If the PR has multiple commits, the diff aggregates ALL changes. Code that appears problematic in the diff may have already been fixed in a subsequent commit. ALWAYS read the actual current file before reporting.

**CRITICAL - Verify Before Reporting:**

The diff shows ALL changes across ALL commits. Issues you see in the diff may have been fixed in later commits within the same PR. You MUST verify each issue still exists before reporting.

For EVERY potential issue:

1. **Use the Read tool** to read the CURRENT file (not the diff) at the specific line numbers
2. **Confirm the exact problematic code is still present** in the current state
3. If the code has been changed/fixed since the diff you're looking at, DO NOT REPORT IT

Example workflow:

- You see `started_at = EXCLUDED.started_at` in the diff and think it should use COALESCE
- Before reporting: `Read` the actual file to check current state
- If file now shows `started_at = COALESCE(...)`, the issue was already fixed - skip it
- Only report if the problematic code is STILL THERE in the current file

**False Positives to Avoid:**

- Pre-existing issues (not introduced by this PR)
- Issues on lines the PR did not modify (EXCEPTION: missing corresponding changes - see below)
- **Issues fixed in subsequent commits within the same PR** - This is the #1 source of false positives. The diff shows cumulative changes. If you see something wrong and later commits fixed it, DO NOT REPORT. Always Read the current file first.
- Test failures, type errors, build errors - CI catches these. Your job is to find issues CI cannot catch.
- Issues a linter/typechecker/compiler would catch (imports, types, formatting)
- General quality issues (test coverage, documentation) unless CLAUDE.md requires them
- Issues called out in CLAUDE.md but explicitly silenced (lint ignore comments)
- Intentional functionality changes related to the PR's purpose
- Theoretical risks without concrete impact
- Issues where you haven't traced the full data flow

**Two-Phase Code Quality Review:**

**Phase 1 - Low-Level (Diff-Focused):**
Shallow scan of the diff itself for obvious issues:

- Logic errors and bugs in the changed code
- Edge cases not handled
- Off-by-one errors, null checks, boundary conditions
- Incorrect variable usage
- Focus ONLY on the changes themselves, not surrounding context

**Phase 2 - High-Level (Context-Focused):**
Understand the bigger picture:

- WHY does this code exist? What problem does it solve?
- Does the change break the existing contract or assumptions?
- Read git blame/history if needed to understand intent
- Check if related code elsewhere needs corresponding changes

**Phase 3 - Historical Context:**
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
---
### Code review

Found N issues:

1. Brief description of the issue (CLAUDE.md says "exact quote" OR bug due to specific reason)

https://github.com/<OWNER>/<REPO>/blob/<SHA>/path/to/file.ts#L10-L20

https://github.com/<OWNER>/<REPO>/blob/<SHA>/path/to/related-file.ts#L50-L60

https://github.com/<OWNER>/<REPO>/blob/<SHA>/CLAUDE.md#L100-L105

2. Next issue description...

[links]

🤖 Generated with [Claude Code](https://claude.ai/code)

<sub>- If this code review was useful, please react with 👍. Otherwise, react with 👎.</sub>
---
```

Or if no issues:

```
<!-- unified-review -->
---
### Code review

No issues found. Checked for bugs, CLAUDE.md compliance, and missing corresponding changes.

🤖 Generated with [Claude Code](https://claude.ai/code)
---
```

**Link Format Requirements:**

- MUST use full SHA (not branch name or HEAD). Commands like `$(git rev-parse HEAD)` won't work in rendered markdown.
- Use `#` after the file name, then `L[start]-L[end]` for line range
- Include 1-2 lines of context before/after the relevant lines (e.g., if commenting on lines 5-6, link to L4-L7)
- Link to ALL relevant files for each issue (the problematic code, related code, CLAUDE.md citation)
- Format: `https://github.com/<OWNER>/<REPO>/blob/<FULL_SHA>/path/file.ts#L10-L15`
- Repo name in URL must match the repo being reviewed

**Supersede Old Comment** (if previous unified-review exists):

First, fetch the old comment body:

```bash
gh api repos/<OWNER>/<REPO>/issues/comments/[ID] --jq '.body'
```

Then update it to preserve the old review in a collapsible block:

```bash
gh api repos/<OWNER>/<REPO>/issues/comments/[ID] -X PATCH -f body="$(cat <<'EOF'
<!-- unified-review:superseded -->
**[New review available here](NEW_COMMENT_URL)**

<details>
<summary>Previous review</summary>

[OLD_COMMENT_BODY with <!-- unified-review --> marker removed]

</details>
EOF
)"
```

**Final Output** - Return ONLY this structured summary:

```
REVIEW_POSTED: <comment_url>
CONFIDENCE: <1-7>
ISSUES_FOUND: <number>
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
Issues found: <N>
Key issues: [list if any]
```

## Example Usage

```
/code-review 72
/code-review
```

## Token Efficiency

This skill uses a single Sonnet agent instead of multiple parallel agents:

- One code exploration pass (not six)
- Shared context across all review perspectives
- Agent posts comment directly (no large content passed back)
- Only structured summary returned to orchestrator
