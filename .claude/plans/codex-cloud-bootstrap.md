# Codex Cloud Bootstrap

## Goal

Add a Codex Cloud setup path for this repo so a cloud task can land in a predictable remote-dev environment, install workspace dependencies, and run repo checks without depending on local Docker orchestration inside the Codex container.

## What Was Built

### Codex Cloud Scripts

Added a dedicated setup script, maintenance script, and doctor script for Codex Cloud. The scripts copy the shared remote-dev env template into `.env`, require Bun, install or resync dependencies, and validate the Codex Cloud prerequisites that should exist in the container.

**Files:**
- `scripts/codex-cloud-setup.sh` — bootstraps the Codex Cloud workspace by copying the shared env template and running `bun install`
- `scripts/codex-cloud-maintenance.sh` — refreshes `.env` from the shared template and reruns `bun install` when a cached environment resumes
- `scripts/codex-cloud-doctor.sh` — checks for `bun`, `.env`, and `node_modules`, then points Docker-backed flows to CI

### Shared Remote-Dev Environment

Unified the Claude web and Codex Cloud remote-dev flows onto a single checked-in env template so both paths point at the same baseline configuration and the repo only has one source of truth for remote sandbox defaults.

**Files:**
- `.env.remote-dev` — shared remote-dev sandbox defaults for both Codex Cloud and Claude web
- `.gitignore` — allows the shared template to remain checked in
- `.claude/settings.json` — updates the Claude SessionStart hook to use `.env.remote-dev`
- `docs/claude-code-web.md` — documents the shared template for the Claude web flow

### Codex Cloud Docs and Scripts Exposure

Documented the Codex Cloud workflow and exposed the setup and doctor entry points through package scripts.

**Files:**
- `docs/codex-cloud.md` — Codex Cloud workflow, expectations, and CI guidance for Docker-backed flows
- `package.json` — adds `codex:setup` and `codex:doctor`

## Design Decisions

### Shared Env Template Across Remote Flows

**Chose:** rename the Claude-only env template into `.env.remote-dev` and reuse it for Codex Cloud.
**Why:** the branch started with separate Codex and Claude env files that carried the same values, which would drift over time.
**Alternatives considered:** keep separate `.env.claude-code-web` and `.env.codex-cloud` files. This was rejected because the duplication created unnecessary config sprawl.

### Fail Loudly on Missing Required Inputs

**Chose:** make setup and maintenance fail immediately if the shared env template or Bun is missing, and make the doctor print actionable failure output for missing Codex Cloud prerequisites.
**Why:** the repo guidance favors loud, actionable failures over silent fallback behavior.
**Alternatives considered:** warn and continue when the template or Bun is missing. This was rejected because it would leave the task in a partially configured state that looks successful.

### Docker-Free Codex Cloud Workflow

**Chose:** remove Docker startup and compose orchestration from the Codex Cloud scripts.
**Why:** Codex Cloud runs inside a managed container, and the final workflow should not depend on Docker-in-Docker for local Postgres or MinIO.
**Alternatives considered:** best-effort Docker startup and `docker compose up` inside the Codex setup path. This was rejected because Docker availability is inconsistent in Codex Cloud and Docker-backed tests already have CI coverage.

## Design Evolution

- **Remote env strategy:** started with a Codex-specific `.env.codex-cloud` file, then converged on a single `.env.remote-dev` template shared with the Claude web path.
- **Docker strategy:** started with best-effort Docker bootstrap for Postgres and MinIO, then pivoted to a Docker-free Codex Cloud workflow after validating the platform constraints and deciding to leave Docker-backed tests to CI.
- **Doctor behavior:** started as a warning-only script, then was tightened to fail on missing Codex Cloud prerequisites while treating Docker-backed services as intentionally out of scope.

## Schema Changes

None.

## What's NOT Included

- No attempt to provision Postgres or MinIO inside Codex Cloud
- No Codex-specific test runner for splitting DB-backed tests from non-DB-backed tests
- No changes to the main local Docker Compose workflow used outside Codex Cloud

## Status

- [x] Add Codex Cloud setup, maintenance, and doctor scripts
- [x] Expose setup and doctor through package scripts
- [x] Unify the remote-dev env template across Claude web and Codex Cloud
- [x] Document the Codex Cloud workflow and its Docker-free constraints
- [ ] Add a dedicated Codex-specific test command or remote database strategy
