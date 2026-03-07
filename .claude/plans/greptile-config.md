# Greptile Code Review Configuration

## Goal

Configure Greptile for automated PR code review that enforces Threa's project invariants (CLAUDE.md) and architectural rules, reducing review burden and catching violations before human review.

## What Was Built

### Greptile Configuration

Core Greptile setup with strictness, comment types, and ignore patterns tuned for the project.

**Files:**
- `.greptile/config.json` — Main config: strictness level 2, logic+syntax comments, ignore generated/lock/dist files, 10 structured rules for the most critical invariants (INV-1, INV-3, INV-4, INV-17, INV-18, INV-20, INV-28, INV-30, INV-41, INV-55)
- `.greptile/files.json` — Points Greptile to key context files: CLAUDE.md (invariants), system-overview.md (architecture), model-reference.md (approved AI models)
- `.greptile/rules.md` — Natural language review calibration: what NOT to flag (pre-existing issues, type errors, style opinions, theoretical risks), security calibration (React XSS safety, ULID unguessability, env vars trusted), architecture rules summary, and plan adherence checking

### Sync Plan Skill

A Claude Code skill that produces/updates committed plan files before PR creation, giving Greptile a spec to check plan adherence against.

**Files:**
- `.agents/skills/sync-plan/SKILL.md` — Skill definition: gathers branch context, reads diff, produces a structured plan file at `.claude/plans/<branch-slug>.md`, and commits it

### Find-Plan Skill Fix

Updated find-plan to check repo-local `.claude/plans/` before the global `~/.claude/plans/` directory, so it finds branch plan files committed to the repo.

**Files:**
- `.agents/skills/find-plan/SKILL.md` — Changed plan file lookup to prefer `$PROJECT_ROOT/.claude/plans/` over `~/.claude/plans/`

### Plans Directory Configuration

**Files:**
- `.claude/settings.json` — Added `plansDirectory: ".claude/plans"` so Claude Code stores plans in-repo where Greptile can access them

## Design Decisions

### Structured rules for critical invariants only

**Chose:** 10 high-severity rules in config.json covering the invariants most likely to be violated and hardest to catch in review
**Why:** CLAUDE.md has 57 invariants — encoding all as structured rules would be noisy and hard to maintain. The natural language rules.md + files.json pointing to CLAUDE.md covers the rest via Greptile's AI understanding.

### Explicit "What NOT to Flag" calibration

**Chose:** Dedicated section in rules.md listing common false positive categories
**Why:** Greptile (like all AI reviewers) tends toward false positives on security, style, and theoretical issues. Pre-calibrating reduces noise and builds trust in the tool.

### Plan files committed to repo

**Chose:** `.claude/plans/` directory checked into git
**Why:** Greptile needs to read plan files during review. Committed plans are available in the PR diff context. The sync-plan skill automates keeping plans current before PR creation.

## Schema Changes

None.

## What's NOT Included

- **Greptile GitHub App installation** — This is config only; the GitHub App must be installed separately via Greptile's dashboard
- **CI integration** — No GitHub Actions or CI pipeline changes; Greptile runs as a GitHub App webhook
- **Coverage of all 57 invariants as structured rules** — Intentionally limited to 10 critical ones; the rest are covered via CLAUDE.md context

## Status

- [x] Greptile config.json with structured rules
- [x] Greptile files.json pointing to key context files
- [x] Greptile rules.md with review calibration
- [x] Sync-plan skill for pre-PR plan synchronization
- [x] Find-plan skill updated to check repo-local plans first
- [x] Plans directory configured in .claude/settings.json
