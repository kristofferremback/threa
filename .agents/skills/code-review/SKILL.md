---
name: code-review
description: Run multi-perspective code review on a PR
allowed-tools: Bash(gh api:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh repo view:*)
---

# Multi-Perspective Code Review

6 parallel Sonnet reviewers → Haiku confidence scorers (threshold ≥80/100) → filtered comment.

## Step 1: Eligibility

```bash
gh pr view <N> --json state,isDraft,author -q '"\(.state)|\(.isDraft)|\(.author.login)"'
```

Skip if: CLOSED/MERGED, isDraft, or bot author (dependabot/renovate/etc).

Check for active unified-review comments to supersede:

```bash
gh api repos/OWNER/REPO/issues/N/comments --jq '[.[] | select(.body | contains("unified-review")) | select(.body | contains("unified-review:superseded") | not) | .id]'
```

Note ALL active IDs — new review supersedes each one.

## Step 2: Identify PR

Use provided number, or `gh pr view --json number,title,url`. Get repo: `gh repo view --json owner,name`.

## Step 3: Gather Context

1. `gh pr view N --json headRefOid,body -q '{sha: .headRefOid, body: .body}'`
2. Find and read CLAUDE.md files (root + directories touched by diff)
3. Spawn **background Haiku agent** (`subagent_type: "general-purpose"`, `run_in_background: true`) to find plan:

> Find implementation plan for current branch. Check: `.claude/plans/`, `~/.claude/plans/`, repo files matching `*.plan.md`/`plan.md`/`plans/*.md`, and session jsonl files in `$HOME/.claude/projects/$(git rev-parse --show-toplevel | sed 's/[\/.]/-/g')`. Read and return combined plan content, or "No plan found".

Collect plan result before Step 4. Store HEAD SHA, PR body, CLAUDE.md content, plan.

## Step 4: Spawn Review Agents

6 parallel Sonnet agents, all `run_in_background: true`, `subagent_type: "general-purpose"`, `model: "sonnet"`. Each gets CLAUDE.md content + PR summary. Do NOT build/typecheck.

**Issue format** (all agents):

```
ISSUES:
- file.ts:10-20 | CATEGORY | Description
```

Categories: `claude-md`, `bug`, `historical`, `plan`, `missing-change`, `abstraction`, `security`, `performance`, `reactivity`. No issues: `ISSUES: none`

---

**Agent 1: CLAUDE.md Compliance** — Audit diff against CLAUDE.md instructions and invariants. `gh pr diff N`, check each change for violations. Cite specific instruction/INV-ID with quotes. Only flag CLEAR violations introduced by this PR. Skip: silenced issues, pre-existing, linter-catchable, general quality, stylistic preferences.

**Agent 2: Bug Scan** — Shallow scan for obvious bugs: logic errors, unhandled edges, off-by-one, null hazards, race conditions. Focus on changes only, large bugs only. Skip if not confident.

**Agent 3: Historical Context** — `gh pr diff N --name-only`, then for each file: `gh pr list --state merged --search "path:<file>" --limit 5`. Check previous PR comments and code comments for guidance. Flag changes violating established patterns or previous feedback.

**Agent 4: Plan Adherence** — Compare diff against plan/PR description. Does code match what was asked? Missing corresponding changes? (API→frontend, type→usages, schema→migration). Use Read to trace data flow. Skip: supporting infrastructure, implementation choices, user-requested additions.

**Agent 5: Design Quality** — Check: leaky abstractions, config sprawl, partial abstractions, parallel implementations, N+1 queries, unbounded queries, missing memoization, outbox/transaction/reactivity issues. Flag concrete issues only.

**Agent 6: Security** — HIGH-CONFIDENCE vulnerabilities only (>80% exploitable). Trace data flow from user inputs. Categories: injection (SQL/cmd/XXE/template/path traversal), auth bypass, hardcoded secrets, deserialization RCE, XSS, data exposure. Severity: HIGH (directly exploitable), MEDIUM (conditional but significant), LOW (defense-in-depth, concrete only). **Hard exclusions:** DoS, rate limiting, disk secrets, theoretical races, outdated deps, memory safety, test-only, log spoofing, path-only SSRF, AI prompt content, regex issues, docs/markdown, missing audit logs, missing hardening without concrete vuln. **Calibration:** React safe unless dangerouslySetInnerHTML. UUIDs unguessable. Env vars trusted. Client-side checks not vulns.

---

## Step 5: Confidence Scoring

Collect all issues. For each, spawn **parallel Haiku agent** (`model: "haiku"`, `subagent_type: "general-purpose"`) with issue, CLAUDE.md, PR number:

> Score 0-100. Run `gh pr diff N` to verify. Rubric: 0=false positive, 25=maybe real/stylistic, 50=real but nitpick, 75=likely real+important, 100=definite+frequent. For CLAUDE.md issues: verify cited instruction actually exists and says what was claimed (score ≤25 if not). Return ONLY: `SCORE: <number>`

**Filter:** Remove issues scoring <80.

## Step 6: Compose Comment

Confidence 1-7: 7=Excellent(none survived), 6=Very Good(minor), 5=Good(few non-blocking), 4=Acceptable(some), 3=Needs Work(multiple), 2=Significant Concerns(blocking), 1=Major Problems.

## Step 7: Re-Check Eligibility

Re-run Step 1 to ensure PR hasn't been closed/drafted during review.

## Step 8: Post Comment

Use `gh pr comment N --body "..."`. Link format: `https://github.com/OWNER/REPO/blob/FULL_SHA/path/file.ts#L10-L15` (MUST use full SHA, include 1-2 lines context).

**If issues found:**

```
<!-- unified-review -->
### Code review
**Confidence: X/7** — [Label]

Found N issues:

1. `file.ts:10-20` — Description (CLAUDE.md: "<quoted>" | bug: <reason> | etc.)
   https://github.com/OWNER/REPO/blob/SHA/path/file.ts#L9-L21

---
<details><summary>📐 Plan Adherence [CLEAN | N issues]</summary>[details]</details>
<details><summary>🔍 Code Quality [CLEAN | N issues]</summary>[details]</details>
<details><summary>📋 CLAUDE.md Compliance [CLEAN | N violations]</summary>[details]</details>
<details><summary>🏗️ Abstraction Design [CLEAN | N concerns]</summary>[details]</details>
<details><summary>🔒 Security [CLEAN | N issues]</summary>[details]</details>
<details><summary>⚡ Performance [CLEAN | N concerns]</summary>[details]</details>
<details><summary>🔄 Reactivity [CLEAN | N issues]</summary>[details]</details>

🤖 Generated with [Claude Code](https://claude.ai/code)
<sub>If this review was useful, react with 👍. Otherwise, react with 👎.</sub>
```

**If no issues survived:**

```
<!-- unified-review -->
### Code review
**Confidence: 7/7** — Excellent

No issues found. Checked for bugs, CLAUDE.md compliance, plan adherence, design quality, security, and performance.

🤖 Generated with [Claude Code](https://claude.ai/code)
<sub>If this review was useful, react with 👍. Otherwise, react with 👎.</sub>
```

**Supersede old comments** (for each active ID from Step 1): Fetch old body via `gh api`, replace `<!-- unified-review -->` with `<!-- unified-review:old -->`, update with `<!-- unified-review:superseded -->`, link to new comment, preserve full old content in `<details>`.

## Step 9: Report to User

```
Code review posted to PR #N: <URL>
Confidence: X/7
Summary:
- 📐 Plan: <status>  - 🔍 Bugs: <status>  - 📋 CLAUDE.md: <status>
- 🏗️ Design: <status>  - 🔒 Security: <status>  - ⚡ Perf: <status>  - 🔄 Reactivity: <status>
Key issues: [list if any]
```

## False Positives (shared — all agents)

Do NOT flag: pre-existing issues, unchanged lines (except missing corresponding changes), CI-catchable issues (types/lint/build), general quality without CLAUDE.md mandate, silenced issues, intentional changes matching PR purpose, theoretical risks, pedantic nitpicks.
