# Threa Code Review Rules

## Project Context

Bun monorepo with four apps: backend (Express + Socket.io), frontend (React 19 + Vite + Shadcn), control-plane (global auth), and workspace-router (Cloudflare Worker).

Refer to CLAUDE.md at the repository root for the full invariant playbook (57 invariants) and architecture rules. The structured rules in config.json cover the most critical invariants; CLAUDE.md is the complete reference.

## What NOT to Flag

- Pre-existing issues not introduced by this PR
- Issues that TypeScript compilation or ESLint would catch (types, imports, lint)
- Stylistic preferences without a concrete rule violation in CLAUDE.md
- Theoretical risks or hypothetical edge cases without evidence of exploitability
- General "best practice" suggestions that don't map to a specific project rule

## Security Calibration

- React JSX is safe from XSS unless `dangerouslySetInnerHTML` is used
- ULIDs/UUIDs are cryptographically unguessable — do not flag as enumeration risks
- Environment variables are trusted — do not flag as hardcoded secrets
- DoS, rate limiting, log spoofing, regex complexity, missing audit logs, and outdated dependency warnings are out of scope

## Architecture Rules

- Backend uses a three-layer model: Handlers (thin, validate + delegate) -> Services (business logic, own transactions) -> Repositories (data access, first arg is Querier)
- Data access goes through repositories, not inline SQL in handlers or services
- No hidden singletons except approved logger, Langfuse/OTEL, and web-push bootstrap
- Dependencies must be constructed once and injected, not assembled per-call from raw config
- Frontend components should stay UI-focused; business logic belongs in hooks or services

## Plan Adherence

If plan files exist in `.claude/plans/`, check that PR changes align with the plan.
Flag missing corresponding changes: API change without frontend update, type change without usage update, schema change without migration.
