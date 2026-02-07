# Threa Audit Report

Date: 2026-02-07
Repository: `/Users/kristofferremback/dev/personal/threa`

## Executive Summary

Threa has a strong foundational architecture for a pre-release product: clear domain model, event-driven processing, good async worker patterns, and a serious AI layer with traceability. The core idea in the docs is reflected in code.

The biggest blockers before public beta are security and operational correctness, not product direction:

- A confirmed privacy leak in websocket payload design for `stream:activity`.
- Open redirect in auth callback flow.
- Sensitive debug/metrics endpoints are unauthenticated.
- Role model exists in data but is not enforced in API authorization.
- Agentic workflows currently lack explicit prompt-injection/exfiltration boundaries.

Maintainability is currently good enough for solo velocity but will slow down quickly with more contributors due to very large files and feature flow sprawl across layer-based folders.

## What Is Working Well

- Architecture aligns with product intent:
  - Streams + conversation boundaries + memos + personas are implemented coherently.
- Async design is robust for current scale:
  - Outbox listeners, cursor locks, queue tokens, cron ticks, and cleanup workers are thoughtfully built.
- Engineering discipline is visible:
  - Consistent typed SQL and Zod usage.
  - Good transaction boundaries.
  - Strong observability base (metrics + trace events).
- AI tool security has a solid baseline for SSRF in `read_url`.

## Highest-Priority Improvements

### 1) Security & Privacy (do before beta)

1. Fix websocket data leak:
   - Stop sending `lastMessagePreview.content` workspace-wide.
   - Make stream previews stream-scoped, or send only non-sensitive aggregate metadata to workspace room.
2. Fix open redirect in auth callbacks:
   - Validate decoded `state` redirect against an allowlist; prefer relative paths.
3. Lock down operational endpoints:
   - Protect `/debug/pool` and `/metrics` behind admin auth or internal network controls.
4. Implement RBAC enforcement:
   - Introduce route-level role checks (`owner/admin/member`) via centralized middleware/policy.
5. Add origin allowlist + rate limits:
   - Replace permissive CORS config with explicit origins.
   - Add per-IP/per-user limits for auth, upload, AI, and search endpoints.

### 2) Agentic Security (do before broad external access)

1. Treat tool output as untrusted input:
   - Add explicit prompt policy: external content can inform facts, never policy/instruction overrides.
2. Add outbound data governance for web tools:
   - Redact sensitive tokens/patterns before external search queries.
   - Add workspace-level web access mode (off, restricted, full).
3. Add agent safety tests:
   - Regression tests for prompt injection attempts in search snippets and page content.

### 3) Reliability & correctness

1. Resolve cron jitter dedupe issue:
   - Deterministic tick schedule creation to ensure dedupe across nodes.
2. Fix `ensureSchedule` created-flag bug (`created` alias vs `xmax` read).
3. Resolve `/health` route shadowing and doc mismatch.
4. Consolidate uncaught exception handling into one clear policy.
5. Add outbox retention/partition strategy.

## Maintainability Assessment

### Current state

The project mixes good abstractions with high local complexity:

- Positive: repositories/services/handlers split is clear.
- Negative: several files have very high line counts and multiple responsibilities.

Observed hotspots:

- `apps/backend/src/agents/persona-agent.ts`
- `apps/backend/src/agents/companion-graph.ts`
- `apps/backend/src/lib/queue-manager.ts`
- `apps/frontend/src/components/layout/sidebar.tsx`

### Recommendation: move from layer-first to bounded feature modules

Keep shared infra, but slice business logic by feature:

- `features/messaging/*`
- `features/conversations/*`
- `features/memos/*`
- `features/agents/*`
- `features/attachments/*`

Within each feature, colocate:

- contracts (schemas/types)
- handlers
- service/orchestrator
- repository access
- policy/authorization
- tests

This will reduce change-sprawl where one feature edit currently touches handlers + services + repos + outbox + socket + frontend hooks across many folders.

## Data Model & Scale (1 -> 10K users)

### Good fit for 1-10K

- Workspace scoping is pervasive.
- Queue/outbox patterns are scalable and horizontally friendly.
- Search architecture (keyword + vector) is pragmatic.

### Risks to address before larger scale

1. Unbounded array columns (`message_ids`, `participant_ids`, `source_message_ids`) can become write hotspots and large-row churn.
2. Large `streamIds` filtering for search may become expensive for larger tenants.
3. No FK constraints means integrity relies entirely on app correctness.
4. No explicit outbox retention.

### Regionalization readiness

Current schema has no explicit workspace placement metadata (home region). Add this now to avoid migration pain:

- `workspace_home_region`
- routing layer that maps workspace -> region endpoint
- background job locality constraints
- explicit policy for cross-region AI/tool calls and data movement

## AI Workflow Review

### Strengths

- Clear component configs and model registry.
- Useful researcher + companion split.
- Cost tracking and budget primitives exist.

### Gaps§

1. Budget not enforced in AI execution path (appears informational).
2. Prompt assembly is string-concatenation heavy and hard to test.
3. Prompt style/quality is inconsistent in a few places.
4. No explicit trust boundary for external tool content.

### Recommended design upgrades

- Introduce an `AIExecutionPolicy` layer:
  - budget gate
  - model downgrade policy
  - tool permissions
  - outbound data policy
- Use versioned prompt templates with snapshot tests.
- Standardize tool contracts and result schema handling across agents.

## Dependency / Tech Choices

### Keep

- `pg`, `zod`, `socket.io`, LangGraph stack, Prometheus telemetry.

### Improve

- Replace direct tarball dependency for `xlsx` with pinned, auditable package source.
- Add automated dependency scanning and SBOM generation in CI.
- Add baseline HTTP hardening middleware (helmet/CSP etc.).

## 30-60-90 Day Remediation Plan

### Next 30 days (beta gate)

1. Fix websocket leak, open redirect, endpoint exposure.
2. Enforce RBAC on sensitive routes.
3. Add CORS allowlist + rate limiting.
4. Add agentic injection/exfiltration guardrails.
5. Fix cron dedupe + `/health` route conflict.

### Days 31-60

1. Add outbox retention and storage lifecycle.
2. Refactor biggest backend/frontend files into bounded modules.
3. Add integration tests to CI and coverage for policy/security paths.

### Days 61-90

1. Introduce workspace region metadata + routing seam.
2. Normalize high-growth array fields into relation tables.
3. Build operational consistency checks (no-FK compensating controls).

## Final Verdict

Threa is in a strong pre-release state conceptually and architecturally, but not yet ready for public beta without targeted hardening. The main work is focused and tractable: fix critical privacy/auth issues, formalize authorization and agentic security policy, and reduce maintainability hotspots before team and user count grow.
