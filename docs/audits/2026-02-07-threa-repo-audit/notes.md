# Threa Repository Audit Notes

Date: 2026-02-07
Auditor: Codex (GPT-5)
Scope: architecture, maintainability, feature gaps, security (traditional + agentic), dependency/runtime best practices.

## 1) What the project is (docs -> code validation)

### 1.1 Product intent from docs

- Threa is positioned as a chat system that preserves organizational knowledge (GAM-inspired memory) and supports AI companions.
- Key concepts are streams (channels/scratchpads/DMs/threads), conversations (boundary extraction), memos (knowledge artifacts), and personas/agents.

### 1.2 Validation in code

- Event-driven stream model with projections is implemented:
  - `apps/backend/src/db/migrations/20251210155323_core_schema.sql` (stream events + messages projection)
  - `apps/backend/src/services/event-service.ts`
- Conversation boundary extraction and memoization are implemented:
  - `apps/backend/src/services/boundary-extraction-service.ts`
  - `apps/backend/src/services/memo-service.ts`
  - `apps/backend/src/db/migrations/20251225231931_conversations.sql`
  - `apps/backend/src/db/migrations/20251226203429_memos.sql`
- Outbox + async worker architecture is implemented:
  - `apps/backend/src/repositories/outbox-repository.ts`
  - `apps/backend/src/lib/outbox-dispatcher.ts`
  - `apps/backend/src/lib/cursor-lock.ts`
- Agent architecture exists with tools, graph loop, tracing:
  - `apps/backend/src/agents/persona-agent.ts`
  - `apps/backend/src/agents/companion-graph.ts`
  - `apps/backend/src/agents/tools/*.ts`

## 2) Key positive findings (what is good)

- Strong separation of concerns (handler/service/repository layering) in backend core.
- Clear use of typed SQL parameterization and schema validation (`zod`) across many endpoints.
- Good async processing model (outbox listeners, cursor lock, DLQ concept, queue tokens, cron tick leasing).
- Thoughtful SSRF mitigation in `read_url` tool:
  - protocol checks, DNS resolution checks, redirect re-validation.
  - `apps/backend/src/agents/tools/read-url-tool.ts`
- Good observability foundation:
  - Prometheus metrics, pool monitor, agent session tracing.
- Good focus on transaction boundaries in services (`withTransaction` usage is frequent and consistent).

## 3) Findings by severity

## Critical

### C1. Stream preview content leaks across workspace via websocket

- Evidence:
  - `apps/backend/src/services/event-service.ts:199-214` inserts `stream:activity` with `lastMessagePreview.content`.
  - `stream:activity` is classified workspace-scoped in `apps/backend/src/repositories/outbox-repository.ts:60-67,161-166`.
  - Workspace-scoped events are broadcast to `ws:${workspaceId}` in `apps/backend/src/lib/broadcast-handler.ts:183-185`.
  - Frontend filters by membership only after receiving payload in `apps/frontend/src/hooks/use-socket-events.ts:396-419`.
- Impact:
  - Any workspace member connected to workspace room can inspect preview content for streams they are not allowed to access.
- Recommendation:
  - Treat `stream:activity` as stream-scoped, or emit two payloads:
    - stream-scoped with preview text
    - workspace-scoped with unread counters only (no content).

## High

### H1. Open redirect in auth callback (production + stub)

- Evidence:
  - `apps/backend/src/auth/handlers.ts:43-45`
  - `apps/backend/src/auth/auth-stub-handlers.ts:43-44`
  - Redirect target is base64-decoded from `state` and used directly.
- Impact:
  - Phishing/chaining risk via trusted auth domain.
- Recommendation:
  - Allowlist redirect targets (relative paths only, or explicit origin allowlist), fallback to `/`.

### H2. Unauthenticated sensitive operational endpoints

- Evidence:
  - Routes exposed without auth in `apps/backend/src/routes.ts:97,184` (`/debug/pool`, `/metrics`).
  - `/debug/pool` returns pool internals and query snippets in `apps/backend/src/handlers/debug-handlers.ts:31-63`.
- Impact:
  - Information disclosure and reconnaissance risk.
- Recommendation:
  - Restrict to admin auth or internal network only. Remove query text from output.

### H3. No role-based authorization despite role model existing

- Evidence:
  - Roles exist in schema (`apps/backend/src/db/migrations/20251210155323_core_schema.sql:28`) and repo types (`apps/backend/src/repositories/workspace-repository.ts:40`).
  - Workspace middleware only checks membership (`apps/backend/src/middleware/workspace.ts:37-44`).
  - No role checks found in backend code (`grep` found none).
  - Budget update endpoint is membership-gated only (`apps/backend/src/routes.ts:178`).
- Impact:
  - Any member can perform admin-level actions where intended permissions are unclear.
- Recommendation:
  - Introduce centralized policy layer (e.g., `requireWorkspaceRole("admin")`) and apply to sensitive endpoints.

### H4. Permissive CORS with credentials

- Evidence:
  - HTTP CORS: `apps/backend/src/app.ts:19` uses `origin: true, credentials: true`.
  - Socket.io CORS: `apps/backend/src/server.ts:312-317` uses same pattern.
- Impact:
  - Overly broad browser origin trust, dangerous if cookie policy changes or future auth flows expand.
- Recommendation:
  - Explicit origin allowlist by environment; reject unknown origins.

### H5. Agentic security gap: tool output treated as trusted prompt context

- Evidence:
  - Tool results are fed directly into `ToolMessage` (`apps/backend/src/agents/companion-graph.ts:864,940-944`).
  - `web_search` and `read_url` return arbitrary external content/snippets (`apps/backend/src/agents/tools/web-search-tool.ts:87-100`, `apps/backend/src/agents/tools/read-url-tool.ts:257-277`).
  - No explicit prompt-injection defenses found in agent prompts/config (search did not find such controls).
- Impact:
  - Prompt injection and data exfiltration risk from malicious web content.
- Recommendation:
  - Add explicit “untrusted tool output” policy in system prompt and tool wrapper.
  - Add guardrails: deny secret leakage, deny instruction override from tool text, add structured citation-only extraction mode.

### H6. No API rate limiting / abuse controls

- Evidence:
  - No rate-limiter middleware found in backend route stack.
- Impact:
  - Increased risk of brute-force, scraping, resource exhaustion (especially pre-auth and AI-heavy endpoints).
- Recommendation:
  - Add per-IP and per-user/workspace rate limits, with stricter controls on auth/AI/search/upload endpoints.

## Medium

### M1. Cron duplicate risk in multi-node generation due per-node jitter

- Evidence:
  - Jitter generated via `Math.random()` in schedule manager: `apps/backend/src/lib/schedule-manager.ts:92-95`.
  - Uniqueness key is `(schedule_id, execute_at)` in migration: `apps/backend/src/db/migrations/20260120070234_cron_schedules.sql:61-64`.
  - Design intent claims multi-worker dedupe by that key: `apps/backend/docs/distributed-cron-design.md:184-187`.
- Impact:
  - Different nodes may compute different `execute_at` for same interval and bypass uniqueness dedupe.
- Recommendation:
  - Use deterministic execute timestamp per schedule interval (DB-generated), optionally apply jitter only at processing time.

### M2. CronRepository `created` flag bug

- Evidence:
  - Query aliases `(xmax = 0) AS created` (`apps/backend/src/repositories/cron-repository.ts:186`) but code checks `row.xmax === "0"` (`:192`).
- Impact:
  - Incorrect `created` reporting (currently mainly logging behavior).
- Recommendation:
  - Read `row.created` boolean directly; remove `xmax` dependency.

### M3. Duplicate `/health` route causes behavior mismatch

- Evidence:
  - `createApp` defines `/health` simple response: `apps/backend/src/app.ts:49`.
  - `registerRoutes` defines `/health` with pool stats: `apps/backend/src/routes.ts:94`, `apps/backend/src/handlers/debug-handlers.ts:17-24`.
  - Docs claim `/health` includes pool stats: `docs/monitoring-connection-pool.md:25-58`.
- Impact:
  - Operational confusion; docs and runtime diverge.
- Recommendation:
  - Keep one health endpoint. Split into `/health` (liveness) and `/health/details` (internal readiness).

### M4. Conflicting global uncaught exception handlers

- Evidence:
  - `server.ts` installs handler with special-case 57P05 handling (`apps/backend/src/server.ts:124-143`).
  - `index.ts` also installs global uncaught handler that shuts down (`apps/backend/src/index.ts:37-40`).
- Impact:
  - Ambiguous crash behavior; hard to reason about reliability.
- Recommendation:
  - Consolidate exception handling in one place with explicit policy table.

### M5. Outbox growth appears unbounded

- Evidence:
  - Outbox table is append-only (`apps/backend/src/repositories/outbox-repository.ts:384-415`).
  - `processed_at` removed (`apps/backend/src/db/migrations/20251216102751_drop_outbox_processed_at.sql:1-10`).
  - No outbox cleanup path found.
- Impact:
  - Long-term storage and index growth; rising query cost/backups.
- Recommendation:
  - Add retention/archival strategy (partition by time, purge by listener watermark + retention window).

### M6. No database foreign keys (intentional) increases integrity burden

- Evidence:
  - No `REFERENCES` in migrations.
  - Intent documented: `CLAUDE.md:148`.
- Impact:
  - Application bugs can create orphan data; harder safe deletes and schema evolution.
- Recommendation:
  - Keep no-FK if desired, but add compensating controls:
    - periodic integrity checks
    - delete orchestration tests
    - consistency dashboard
    - stronger service-level invariants.

### M7. Data model fields likely to grow unbounded in single-row arrays

- Evidence:
  - `conversations.message_ids`, `participant_ids` arrays (`apps/backend/src/db/migrations/20251225231931_conversations.sql:15-19`).
  - `memos.source_message_ids`, `participant_ids` arrays (`apps/backend/src/db/migrations/20251226203429_memos.sql:24-26`).
- Impact:
  - Update amplification, large row churn, contention and performance degradation as data grows.
- Recommendation:
  - Move high-cardinality arrays to join tables for scalable writes/reads.

### M8. Region/data-residency path not modeled yet

- Evidence:
  - `workspaces` schema has no region/home placement field (`apps/backend/src/db/migrations/20251210155323_core_schema.sql:11-18`).
  - No region routing/residency references found in backend docs/code (except S3 client region config).
- Impact:
  - Harder migration to per-region workspace deployment later.
- Recommendation:
  - Introduce `workspace_home_region` + request routing abstraction now, even if single-region initially.

### M9. Security headers missing in HTTP layer

- Evidence:
  - No `helmet` or equivalent headers middleware in app bootstrap.
- Impact:
  - Weaker baseline against browser-side attacks/misconfig.
- Recommendation:
  - Add hardened baseline headers (CSP, frameguard, HSTS in prod, etc.).

### M10. File upload pipeline lacks content-type policy and malware scanning

- Evidence:
  - Explicitly no file type restrictions (`apps/backend/src/middleware/upload.ts:10-12`).
- Impact:
  - Higher risk when opening to external users.
- Recommendation:
  - Add scanning/quarantine workflow and configurable mime allowlist per workspace policy.

## Maintainability / feature architecture

### MA1. Large multi-responsibility files raise change risk

- Evidence (line counts):
  - `apps/backend/src/agents/persona-agent.ts` (1570)
  - `apps/backend/src/agents/companion-graph.ts` (1285)
  - `apps/backend/src/lib/queue-manager.ts` (828)
  - `apps/frontend/src/components/layout/sidebar.tsx` (1416)
- Impact:
  - Hard reviewability and slower onboarding.
- Recommendation:
  - Extract use-case modules (prompt assembly, tool policy, stream sidebar sections, queue lease lifecycle).

### MA2. Feature changes span many layer-first folders (sprawl)

- Evidence:
  - Example path for message activity: service -> outbox repo type -> broadcast handler -> socket rooms -> frontend hook cache updates.
- Impact:
  - High coordination cost and regression risk for single feature changes.
- Recommendation:
  - Introduce feature slices (e.g., `features/messaging`, `features/ai-companion`) with local handler/service/repo/policy boundaries.

### MA3. Docs drift in core concepts

- Evidence:
  - `docs/core-concepts.md:251-253` references `memo_sources` and `persona_tools`, but current schema uses arrays (`source_message_ids`, `enabled_tools`).
  - `docs/problem-statement.md:142-148` uses “thinking space” stream type; schema stream types are `scratchpad|channel|dm|thread` in `apps/backend/src/db/migrations/20251210155323_core_schema.sql:41`.
- Impact:
  - Increases mental overhead and implementation mistakes.
- Recommendation:
  - Add docs drift CI checks or a periodic docs validation task tied to migrations/types.

### MA4. Integration tests exist but are not in default CI path

- Evidence:
  - Integration suite script exists: `apps/backend/package.json` (`test:integration`).
  - Default CI runs only backend `test` (unit + e2e): `.github/workflows/ci.yml` and `apps/backend/package.json`.
- Impact:
  - Important cross-layer access control checks may not run on PRs.
- Recommendation:
  - Add integration suite to CI (or merge into e2e where feasible).

## AI workflow design / cost / structure

### AI1. Budget logic implemented but not enforced in execution path

- Evidence:
  - `AIBudgetService` exists with `checkBudget/getRecommendedModel`: `apps/backend/src/services/ai-budget-service.ts`.
  - No usage of `AIBudgetService` found outside itself (`grep`), suggesting no hard gating at runtime.
- Impact:
  - Budget controls may be informational only.
- Recommendation:
  - Enforce budget checks in common AI call path (`createAI` wrappers / agent runner) before invocation.

### AI2. Prompt quality inconsistency and maintainability concerns

- Evidence:
  - Prompt strings are manually concatenated in large function `buildSystemPrompt` (`apps/backend/src/agents/persona-agent.ts:1161+`).
  - Stream naming prompt includes non-professional emotional phrasing (`apps/backend/src/services/stream-naming/config.ts:38`).
- Impact:
  - Hard to reason about behavior and hard to test prompt regressions.
- Recommendation:
  - Move prompts to structured templates + test snapshots + lint rules for prompt style.

### AI3. External search query exfiltration risk is not policy-gated

- Evidence:
  - `web_search` sends model-generated query directly to Tavily (`apps/backend/src/agents/tools/web-search-tool.ts:61-73`).
  - No explicit outbound content policy layer found.
- Impact:
  - Sensitive workspace terms can be sent to external search unintentionally.
- Recommendation:
  - Add query redaction/policy gate and configurable “web access mode” by workspace.

## 4) Best-practice / dependency notes

- Good: `zod`, parameterized SQL, socket room auth checks, SSRF checks.
- Watch:
  - `xlsx` loaded from direct tarball URL in `apps/backend/package.json` (supply-chain/reproducibility risk).
  - Public beta should include dependency pinning/auditing and SBOM generation.

## 5) Suggested remediation order

1. Fix data leak + open redirect + endpoint exposure (`C1`, `H1`, `H2`) before beta.
2. Add RBAC + CORS allowlist + rate limiting (`H3`, `H4`, `H6`).
3. Add agentic guardrails and outbound policy (`H5`, `AI3`).
4. Stabilize reliability and operability (`M1`, `M2`, `M3`, `M4`, `M5`).
5. Reduce maintenance cost via modularization + docs drift guardrails (`MA1-MA4`, `AI2`).
6. Prepare regionalization by adding workspace placement model (`M8`).
