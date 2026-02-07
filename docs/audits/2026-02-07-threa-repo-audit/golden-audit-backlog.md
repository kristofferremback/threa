# Threa Golden Audit Backlog (Combined)

Date: 2026-02-07
Source audits:

- `/Users/kristofferremback/dev/personal/threa/docs/audits/2026-02-07-threa-repo-audit/report.md`
- `/Users/kristofferremback/dev/personal/threa/docs/audits/2026-02-07-threa-repo-audit/notes.md`
- `/Users/kristofferremback/dev/personal/threa.claude-repository-audit/docs/audit/repository-audit.md`

## Prioritization Principles

1. P0 = must-fix before public beta (security/privacy/trust blockers).
2. P1 = high-value improvements, with **feature colocation as the first execution track** per your stated priority.
3. P2 = important but deferrable optimizations and cleanup.

## P0 (Must Fix Before Public Beta)

### P0-1. Fix workspace-wide stream preview leak (websocket privacy)

- Problem: `stream:activity` includes `lastMessagePreview.content` and is broadcast workspace-wide.
- Why P0: Direct unauthorized data exposure risk.
- Actions:

1. Make `stream:activity` stream-scoped when content is included.
2. If workspace-scoped event is needed, remove message content and keep aggregate metadata only.
3. Add regression tests for non-member sockets not receiving preview content.

### P0-2. Fix auth callback open redirect

- Problem: base64-decoded `state` is used directly in `res.redirect`.
- Why P0: phishing and trust-boundary vulnerability.
- Actions:

1. Only allow relative internal paths (or strict allowlist).
2. Fallback to `/` on invalid redirect target.
3. Apply same fix to stub auth handler.

### P0-3. Add endpoint abuse protection (rate limits)

- Problem: no API throttling across auth/search/AI/write-heavy endpoints.
- Why P0: brute-force, abuse, and cost amplification risk.
- Actions:

1. Add global baseline limiter.
2. Add stricter per-route policies for auth, AI, search, uploads, and message creation.
3. Add workspace/user-based quotas for expensive AI-triggering flows.

### P0-4. Lock down operational endpoints

- Problem: `/debug/pool` and `/metrics` are exposed unauthenticated.
- Why P0: internal topology/query leakage and recon surface.
- Actions:

1. Restrict to internal network and/or admin auth.
2. Remove query text leakage from debug output.
3. Keep a safe public liveness endpoint separate from internal readiness diagnostics.

### P0-5. Enforce authorization policy (RBAC, not membership-only)

- Problem: role model exists (`owner/admin/member`) but route enforcement is largely membership-only.
- Why P0: privilege escalation within shared workspaces.
- Actions:

1. Add centralized authorization middleware/policy layer.
2. Apply role gates to budget/config/admin-like operations.
3. Add authorization matrix tests.

### P0-6. Establish minimum agentic safety boundary

- Problem: external tool outputs are consumed as trusted context without explicit anti-injection guardrails.
- Why P0: prompt injection and external-content instruction override risk.
- Actions:

1. Add system-level rule: tool output is untrusted data, never instructions.
2. Add policy checks for secret/data exfiltration patterns.
3. Add prompt-injection regression tests using malicious web content/tool outputs.
4. Make the tool-output **trust boundary** explicit in prompts, wrappers, and tests.

### P0-7. Block stub auth in production

- Problem: `USE_STUB_AUTH=true` logs a warning but is not hard-blocked.
- Why P0: catastrophic misconfiguration risk.
- Actions:

1. Throw on startup when stub auth is enabled in production.
2. Ensure dev-only routes are never mounted in production.

### P0-8. Harden browser-facing baseline

- Problem: permissive CORS and missing security headers.
- Why P0: prevent avoidable web attack surface expansion.
- Actions:

1. Replace `origin: true` with explicit allowlist by environment.
2. Add helmet/security headers (CSP/frameguard/HSTS strategy appropriate to deployment).

## P1 (High Value, Next Wave)

## P1-A. **Feature Colocation Track (Your Next Priority)**

### P1-A1. Create feature slices in backend

- Goal: reduce cross-layer sprawl and make features locally navigable.
- Actions:

1. Introduce `features/` domain slices (e.g., `messaging`, `conversations`, `memos`, `agents`, `attachments`).
2. Co-locate handler/service/repository/contracts/policy/tests per feature.
3. Keep shared infra in `lib/` only for true cross-cutting utilities.

### P1-A2. Split large multi-responsibility files

- Targets:

1. `apps/backend/src/agents/persona-agent.ts`
2. `apps/backend/src/agents/companion-graph.ts`
3. `apps/backend/src/lib/queue-manager.ts`
4. `apps/frontend/src/components/layout/sidebar.tsx`

- Actions:

1. Extract prompt assembly, policy enforcement, and tool orchestration modules.
2. Extract sidebar section modules and data transforms.
3. Add unit tests around extracted boundaries.

### P1-A3. Reorganize backend `lib/` catch-all

- Goal: remove “misc bucket” effect and improve discoverability.
- Actions:

1. Move domain-specific handlers/workers into feature folders.
2. Keep `lib/` for logging, serialization, temporal, metrics primitives.

### P1-A4. Add architecture guardrails

- Actions:

1. Add lightweight ADR + folder conventions doc for feature colocation.
2. Add lint/check to prevent new feature logic from being added to root `lib/` unnecessarily.
3. Preserve existing frontend strengths while refactoring (feature-oriented component grouping and colocated tests).

## P1-B. Reliability and consistency

### P1-B1. Fix cron correctness issues

- Actions:

1. Replace per-node random jitter execution timestamp with deterministic schedule tick generation.
2. Fix `ensureSchedule` created-flag bug (`created` alias vs `xmax` read).

### P1-B2. Resolve duplicate `/health` route behavior

- Actions:

1. Keep one canonical liveness route.
2. Move detailed pool stats to an internal readiness endpoint.
3. Align docs with actual endpoint contracts.

### P1-B3. Consolidate global crash handling

- Actions:

1. Merge duplicated `uncaughtException` handling into one policy.
2. Explicitly classify non-fatal DB/session timeout cases.

### P1-B4. Add outbox retention lifecycle

- Actions:

1. Purge/archive outbox rows based on listener watermark + retention window.
2. Consider partitioning for long-term scale.

### P1-B5. Put integration tests into default CI

- Actions:

1. Include `test:integration` in CI gating.
2. Add critical security/authz/regression tests for P0 fixes.

### P1-B6. Enforce AI budget in execution path

- Problem: budget logic exists but appears non-blocking/informational in runtime path.
- Actions:

1. Add pre-invocation budget checks in unified AI call path.
2. Apply model degradation/hard-stop policies based on workspace config.

### P1-B7. Improve long-context behavior for agent conversations

- Problem: context truncation currently risks dropping important older context in long threads.
- Actions:

1. Add rolling summaries for dropped history segments.
2. Persist/update summary state so follow-up turns keep critical context.
3. Add regression tests for long-conversation quality.

### P1-B8. Strengthen attachment upload safety policy

- Actions:

1. Enforce configurable content-type allowlist for public-beta defaults.
2. Add malware scanning/quarantine workflow before broad external sharing flows.
3. Add tests for blocked file types and unsafe upload paths.

## P2 (Important, Deferrable)

### P2-1. Data model cleanup and scalability refinements

- Actions:

1. Migrate high-growth arrays (`conversation.message_ids`, memo source arrays) to join tables.
2. Drop dead `messages.reactions` column if no longer source of truth.
3. Review and add workspace-aware index strategy for future sharding/multi-region evolution.
4. Validate and enforce attachment parent/association constraints (attachment must belong to expected workspace/stream lifecycle).

### P2-2. Regionalization readiness model

- Actions:

1. Introduce `workspace_home_region` metadata and routing seam.
2. Define cross-region migration workflow and constraints.

### P2-3. Documentation and drift control

- Actions:

1. Align docs with implemented schema/types (e.g., thinking-space wording, table references).
2. Add periodic docs validation checks tied to migrations/types.

### P2-4. Additional hardening and quality improvements

- Actions:

1. Model availability startup checks (OpenRouter catalog drift).
2. Expand branded ID coverage where it provides high safety value.
3. Dependency hygiene improvements (supply-chain pinning and scanning).
4. Vector index tuning and query-level search parameter tuning when data scale warrants.
5. Make explicit trust-boundary controls for tool outputs and outbound web tool governance.

### P2-5. Session and auth policy tuning

- Actions:

1. Re-evaluate session cookie lifetime policy (e.g., shorter cookie `maxAge` with sliding refresh).
2. Add explicit auth/session policy documentation for public beta security review.

### P2-6. Outbox and realtime throughput scaling path

- Actions:

1. Define horizontal scaling strategy for outbox handlers at higher event volumes.
2. Add workload/partition plan (e.g., workspace-based partitioning or handler sharding) before growth pressure.

### P2-7. Connection pool and runtime capacity tuning

- Actions:

1. Revisit pool sizing and queue concurrency targets ahead of beta load profiles.
2. Document scale thresholds and escalation plan (pool, worker count, queue latency SLOs).

### P2-8. No-FK compensating controls

- Actions:

1. Add periodic integrity checks for orphan detection and invariant drift.
2. Add deletion/orchestration tests and runbook for consistency repair procedures.

### P2-9. AI cost and prompt quality improvements

- Actions:

1. Add targeted AI cost optimizations (batching and skip heuristics where quality is preserved).
2. Improve prompt modularity/testability with versioned templates and regression snapshots.
3. Add explicit persona prompt sandboxing for shared-workspace safety.

### P2-10. Dependency specificity and supply-chain clarity

- Actions:

1. Replace ad-hoc tarball dependency usage (e.g., `xlsx`) with pinned and auditable package sources.
2. Add dependency policy docs and automated checks in CI.

## Recommended Execution Sequence

1. Complete all P0 items.
2. Immediately start P1-A (feature colocation) as the primary engineering track.
3. Run P1-B in parallel where low-coupling allows (CI, health route, crash handling).
4. Schedule P2 as roadmap epics after beta stabilization metrics are healthy.

## Definition of Done (Backlog Governance)

- Each item has:

1. Code changes merged.
2. Tests covering regressions and expected behavior.
3. Ops/docs updates.
4. Rollout notes (including migration/compatibility impact when relevant).
