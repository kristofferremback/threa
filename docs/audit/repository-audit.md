# Threa Repository Audit

**Date:** 2026-02-07
**Scope:** Security, architecture, maintainability, data design, AI workflows, code practices
**Context:** Pre-release, solo developer, targeting public beta with growth path to 10K users

---

## Executive Summary

Threa is an impressively well-architected system for a solo project. The codebase demonstrates strong engineering discipline: consistent patterns (repository/service/handler layers), thoughtful invariants (50+ documented), and sophisticated real-time infrastructure. The AI integration is particularly well-designed with proper cost tracking, connection pool management (three-phase pattern), and structured output validation.

**What's working well:**

- Architecture patterns are consistent and well-documented
- SQL injection protection is excellent (parameterized queries everywhere)
- WebSocket authentication and room authorization are comprehensive
- AI workflows follow the three-phase pattern correctly, preventing pool exhaustion
- Frontend is well-organized with feature-based colocation
- Type system is strong with branded IDs and const-enum patterns

**What needs attention before public beta:**

- Several security gaps that are fine for solo use but dangerous with real users
- Backend `lib/` directory has become a catch-all (55 files at root level)
- Outbox table grows unbounded with no cleanup mechanism
- No rate limiting anywhere in the stack

The rest of this document covers findings organized by severity and category.

---

## 1. Security

### 1.1 Critical: Open Redirect Vulnerability

**Location:** `apps/backend/src/auth/handlers.ts:43-45`

The OAuth callback decodes `state` from base64 and redirects without validating the target:

```typescript
const redirectTo = state ? Buffer.from(state, "base64").toString("utf-8") : "/"
res.redirect(redirectTo) // No validation
```

An attacker can craft a login URL like `/api/auth/login?redirect_to=https://attacker.com/phishing` — after authentication succeeds, the user is redirected to the attacker's site. Classic open redirect.

**Fix:** Validate that `redirectTo` is a relative path (starts with `/` and doesn't start with `//`):

```typescript
function isSafeRedirect(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//")
}
const redirectTo = state ? Buffer.from(state, "base64").toString("utf-8") : "/"
res.redirect(isSafeRedirect(redirectTo) ? redirectTo : "/")
```

### 1.2 Critical: No Rate Limiting

No rate limiting exists anywhere in the codebase. No `express-rate-limit`, no Redis-based throttling, no custom implementation. Every endpoint can be hammered without restriction.

**Risk for public beta:**

- **Auth endpoints:** Brute force/credential stuffing on `/api/auth/callback`
- **Search:** Resource exhaustion on `POST /api/workspaces/:id/search` (triggers full-text + vector search)
- **AI endpoints:** Cost amplification — an authenticated user can trigger unlimited AI calls (companion, naming, memo classification, embeddings) at your expense
- **Message creation:** Spam flooding

**Fix:** Add `express-rate-limit` with per-endpoint configuration. Priority tiers:

| Tier     | Endpoints                    | Suggested Limit  |
| -------- | ---------------------------- | ---------------- |
| Strict   | `/api/auth/*`                | 5/15min per IP   |
| AI       | Companion, naming, search    | 30/min per user  |
| Standard | Message creation, stream ops | 60/min per user  |
| Relaxed  | Read-only GETs               | 300/min per user |

### 1.3 High: Debug Endpoint Exposes Internals

**Location:** `apps/backend/src/routes.ts:184` + `handlers/debug-handlers.ts`

`GET /debug/pool` is registered with no authentication and exposes:

- Database pool internal state (connection counts, client status)
- The last SQL query text (first 100 chars) for each active connection
- Pending queue length

This reveals schema details and internal implementation to anyone who can reach the endpoint.

**Fix:** Gate behind `NODE_ENV !== "production"` or require authentication:

```typescript
if (process.env.NODE_ENV !== "production") {
  app.get("/debug/pool", debug.poolState)
}
```

### 1.4 High: No Security Headers

No `helmet` middleware. Missing all standard headers:

- `X-Frame-Options: DENY` (clickjacking protection)
- `Content-Security-Policy` (XSS defense-in-depth)
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options: nosniff`

**Fix:** `bun add helmet` and add to middleware chain:

```typescript
import helmet from "helmet"
app.use(helmet())
```

### 1.5 Medium: CORS Allows Any Origin

**Location:** `apps/backend/src/app.ts:19`

```typescript
app.use(cors({ origin: true, credentials: true }))
```

`origin: true` reflects any origin back, allowing any website to make credentialed requests. Fine for development, but in production this means a malicious site could make API calls on behalf of any logged-in user.

**Fix:** Set `origin` to the frontend URL in production:

```typescript
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
)
```

### 1.6 Medium: Stub Auth Has No Production Guard

**Location:** `apps/backend/src/lib/env.ts:47`

Stub auth is controlled solely by `USE_STUB_AUTH=true` environment variable. There's a warning log but no hard block:

```typescript
if (useStubAuth) {
  logger.warn("Using stub auth service - NOT FOR PRODUCTION")
}
```

If someone misconfigures production, `/api/dev/login` becomes available, allowing anyone to log in as any email without credentials.

**Fix:** Add explicit production block:

```typescript
if (useStubAuth && process.env.NODE_ENV === "production") {
  throw new Error("USE_STUB_AUTH cannot be enabled in production")
}
```

### 1.7 Low: Session Cookie MaxAge is 30 Days

30-day sessions are long. If a session token is stolen, the attacker has a month. Consider 7 days with sliding refresh for active users.

### 1.8 Agentic Security

The agentic security posture is **strong**:

- **Prompt injection defense:** User message content is passed through message formatters before inclusion in prompts. LLM output is validated against Zod schemas with structured output enforcement. No raw interpolation.
- **Tool sandboxing:** Personas have explicit `enabledTools[]` arrays. Tools are read-only (except `send_message`). No dynamic code execution.
- **Workspace isolation:** All tool operations respect workspace membership boundaries. Search results are filtered by stream access.
- **Cost protection:** Cost tracking records every AI call. Budget alerts fire at 50%/80%/100% thresholds.
- **Memo classifier filters AI content:** Explicitly excludes persona-generated messages from knowledge extraction, preventing circular memorization.

**One concern:** Persona system prompts are user-editable and used as-is at runtime. A user could craft a persona prompt that instructs the LLM to exfiltrate conversation data via `web_search` or `read_url`. This is acceptable when users own their workspace, but becomes a risk with shared workspaces where one user creates a persona that others interact with.

**Suggestion for shared workspaces:** Consider adding system-level instruction wrapping around user-defined persona prompts that prevents data exfiltration patterns.

---

## 2. Data Design

### 2.1 Critical: Outbox Table Grows Unbounded

The `outbox` table has no cleanup mechanism. Events are written continuously (every message, reaction, stream update) but never deleted. The `processed_at` column was dropped in favor of cursor tracking, but no retention policy was added.

Over months of active use, this table will:

- Grow into millions of rows
- Degrade BIGSERIAL performance (sequence bloat)
- Consume storage with JSONB payloads

**Fix:** Add a cleanup job to the existing `CleanupWorker`:

```typescript
// Delete outbox events older than 7 days (all listeners will have processed them)
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
await pool.query(sql`DELETE FROM outbox WHERE created_at < ${cutoff}`)
```

### 2.2 Medium: Dead `reactions` JSONB Column

The original `messages.reactions` JSONB column still exists in the schema despite reactions being migrated to a separate `reactions` table. The migration (`20251211084312_reactions_table.sql`) notes "we keep the column but it's no longer the source of truth" but no follow-up migration drops it.

**Fix:** Add a migration: `ALTER TABLE messages DROP COLUMN reactions;`

### 2.3 Medium: No Workspace-Scoped Indexes

The codebase philosophy is "workspace is the sharding boundary" for future multi-region. However, most indexes don't include `workspace_id` as a prefix:

- `idx_messages_stream_id` indexes `(stream_id)` but not `(workspace_id, stream_id)`
- `idx_stream_events_stream_id` same pattern

This is fine for single-database deployment, but when you partition by workspace for regional sharding, you'll need to rebuild indexes. Not urgent, but worth noting for the migration plan.

### 2.4 Low: No Foreign Keys (By Design)

The no-FK philosophy is documented (INV-1) and consistently applied. The tradeoff is clear: application manages relationships for flexibility, at the cost of potential orphaned records. With workspace-scoped deletion, this is manageable. Just ensure cascade-delete logic is tested thoroughly before launch.

### 2.5 Observation: HNSW Vector Index Parameters

The embedding index uses `m=16, ef_construction=64`. These are reasonable defaults but conservative. As the message count grows past 100K, you may want to tune:

- Increase `ef_construction` to 128-200 for better recall
- Consider `ef_search` parameter at query time for precision/speed tradeoff

---

## 3. Maintainability

### 3.1 Backend `lib/` Is a Catch-All

`apps/backend/src/lib/` contains **55 files** at the root level. This includes everything from `logger.ts` to `broadcast-handler.ts` to `cleanup-worker.ts` to `temporal.ts`. Some files are organized into subdirectories (`ai/`, `memo/`, `storage/`, `stream-naming/`, `boundary-extraction/`, `embedding/`), but most are not.

**The problem:** When looking for code related to a feature, you have to know which of 55+ files are relevant. The `lib/` directory has become "everything that's not a handler, service, or repository."

**Suggested reorganization:**

```
lib/
├── ai/              # Already exists - AI wrapper, model registry, cost tracking
├── auth/            # Cookie config, session utils (currently scattered)
├── broadcast/       # BroadcastHandler, user-socket-registry
├── cron/            # CronRunner, CronRepository, CleanupWorker
├── memo/            # Already exists - classifier, memorizer, config
├── outbox/          # OutboxDispatcher, CursorLock, debounce
├── realtime/        # Outbox handlers (naming, companion, emoji, embedding, boundary)
├── search/          # Search-related utilities
├── storage/         # Already exists - S3 client
├── stream-naming/   # Already exists
├── boundary-extraction/ # Already exists
├── embedding/       # Already exists
├── temporal.ts      # Date/time utilities (standalone is fine)
├── id.ts            # ID generation (standalone is fine)
├── logger.ts        # Logger (standalone is fine)
├── env.ts           # Environment config (standalone is fine)
└── http-errors.ts   # Error classes (standalone is fine)
```

The key move: group outbox handlers, broadcast, and cron into feature directories rather than leaving them flat.

### 3.2 Feature Tracing: The Memo Feature

To assess how easy it is to find all code related to a feature, I traced the "memo" feature:

| Layer          | Location                                                 | Files                  |
| -------------- | -------------------------------------------------------- | ---------------------- |
| Types          | `packages/types/src/constants.ts`, `domain.ts`, `api.ts` | Mixed with other types |
| Repository     | `repositories/memo-repository.ts`                        | 1 file                 |
| Service        | `services/memo-service.ts`                               | 1 file                 |
| Handler        | `handlers/memo-handlers.ts`                              | 1 file                 |
| AI Config      | `lib/memo/config.ts`                                     | 1 file                 |
| AI Classifier  | `lib/memo/classifier.ts`                                 | 1 file                 |
| AI Memorizer   | `lib/memo/memorizer.ts`                                  | 1 file                 |
| Outbox Handler | `lib/memo-accumulator-handler.ts`                        | In lib/ root           |
| Worker         | `workers/memo-batch-worker.ts`                           | 1 file                 |
| Evals          | `evals/suites/memo-classifier/`                          | Separate directory     |

**Assessment:** The AI components are well-colocated in `lib/memo/`. The handler, service, and repository follow consistent naming. The outbox handler sitting in `lib/` root is the only stray file. Overall, the memo feature is **reasonably traceable** — you can find most files by searching for "memo" in filenames.

### 3.3 Frontend Organization Is Excellent

Frontend components are organized by feature domain (`composer/`, `editor/`, `timeline/`, `thread/`, `conversations/`, `quick-switcher/`, `settings/`, `trace/`). Tests are colocated. The Shadcn UI components sit separately in `ui/`. The context providers are clean and well-separated. No major sprawl issues.

### 3.4 Handler/Service/Repository Layer Counts

| Layer           | Count                       | Assessment                             |
| --------------- | --------------------------- | -------------------------------------- |
| Handlers        | ~15 files                   | Well-focused, thin orchestrators       |
| Services        | ~20 files                   | Business logic, transaction management |
| Repositories    | ~20 files                   | Pure data access, consistent patterns  |
| Workers         | ~10 files                   | Thin wrappers calling services         |
| Outbox Handlers | ~10 files                   | Event-driven triggers                  |
| Agents          | ~30 files (including tools) | Complex but well-structured            |

The layering is consistent and the count per layer is manageable. No layer is bloated.

### 3.5 Configuration Sprawl Check

AI model IDs are well-centralized:

- Environment defaults in `lib/env.ts`
- Per-feature configs in colocated `config.ts` files (`lib/memo/config.ts`, `agents/companion/config.ts`, etc.)
- Persona model stored in database per persona

No scattered magic strings for model IDs found in handlers or services. The INV-44 (AI Config Co-location) invariant is respected.

---

## 4. AI Workflows

### 4.1 Architecture Is Coherent

All AI workflows follow the same pattern:

1. Config file with model ID, temperature, system prompt
2. Service that implements three-phase pattern (fetch data → AI call without DB connection → save results)
3. Zod schema validation on LLM output
4. Cost recording via AI wrapper

This consistency makes the system predictable and maintainable. Adding a new AI feature follows a clear template.

### 4.2 Model Selection Is Reasonable

| Task           | Model                  | Cost | Assessment                             |
| -------------- | ---------------------- | ---- | -------------------------------------- |
| Classification | gpt-oss-120b           | Low  | Good for binary decisions              |
| Memorization   | gpt-oss-120b           | Low  | Adequate for structured extraction     |
| Companion      | claude-sonnet-4.5      | High | Appropriate for conversational quality |
| Naming         | gpt-4.1-mini           | Low  | Good for short text generation         |
| Boundary       | gpt-4.1-mini           | Low  | Good for classification                |
| Research       | gpt-oss-120b           | Low  | Good for multi-step reasoning          |
| Embeddings     | text-embedding-3-small | Low  | Standard choice                        |

**Concern:** The default fallback models in `env.ts` reference `openai/gpt-5-mini` and `openai/gpt-oss-120b`. These model paths need to stay current with OpenRouter's catalog. If OpenRouter removes or renames a model path, the system fails at runtime with no graceful degradation.

**Suggestion:** Add a startup health check that validates the configured models are available via OpenRouter's API.

### 4.3 Prompt Design Is Solid

Prompts are well-structured with:

- Clear role instructions
- Explicit output format requirements ("Respond with ONLY valid JSON")
- Negative examples ("NOT gems: simple acknowledgments...")
- Anti-hallucination directives ("Be SELF-CONTAINED", "Be FACTUAL")

The memo classifier explicitly filters AI-generated content — a thoughtful detail that prevents circular knowledge extraction.

### 4.4 Cost Optimization Opportunities

1. **Memo classification batching:** Currently each message is classified independently. For channels with burst activity, batching 5-10 messages into one classification call would reduce costs ~80%.

2. **Embedding deduplication:** If a message is edited, a new embedding is generated. Consider skipping re-embedding for trivial edits (typo fixes, formatting changes).

3. **Researcher skip heuristics:** The researcher agent decides whether to search workspace knowledge. The skip heuristics are good but could be more aggressive — simple follow-up messages in active conversations rarely need workspace search.

### 4.5 Context Window Management

The companion graph truncates message history at 400K chars (~100K tokens). This is reasonable but the truncation strategy (keep newest, drop oldest) means the companion can lose important early context in long conversations. Consider a "summary of dropped messages" approach for conversations that exceed the limit.

---

## 5. Code Practices

### 5.1 SQL Safety: Excellent

All database queries use the `sql` template tag from squid/pg. No string interpolation in SQL detected anywhere in the codebase. Array parameters use `sql.array()` or `ANY()` with parameterized values. This is exactly right.

### 5.2 XSS Prevention: Strong

- Frontend uses `react-markdown` with HTML escaping by default
- No `dangerouslySetInnerHTML` with user content (only used for Shiki syntax highlighting output and chart CSS — both from trusted sources)
- External links use `target="_blank" rel="noopener noreferrer"`
- Markdown URL transformer blocks `javascript:` and `data:` protocols
- Tests verify `<script>` and `<iframe>` tags are stripped

### 5.3 Error Handling: Consistent

The `HttpError` hierarchy (`NotFoundError`, `ForbiddenError`, `BadRequestError`, `ConflictError`) is used consistently. The error handler middleware catches these and formats responses without leaking stack traces. Errors in services use `fel` for structured error context.

### 5.4 Type Safety Gaps

The branded ID types (INV-50) currently only cover `UserId`, `MemberId`, and `WorkspaceId`. Other entity IDs (`StreamId`, `MessageId`, `PersonaId`, `AttachmentId`, `MemoId`) are plain strings. This means the compiler can't catch accidental ID mixing for these types.

**Suggestion:** Gradually extend branded IDs to cover all entity types. Start with `StreamId` since stream operations are the most common.

### 5.5 Testing

- Backend: Tests are colocated with source files. Integration tests exist for key flows.
- Frontend: ~10+ test files covering critical paths (markdown rendering, editor behavior, loading states).
- No `.todo()` or `.skip()` tests found (INV-26 respected).
- The test-to-source ratio is moderate — adequate for current size but should grow with public launch.

### 5.6 Technology Observations

| Technology                 | Assessment                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Bun**                    | Good choice for dev speed. Watch for edge cases in production (less battle-tested than Node for WebSocket-heavy workloads). |
| **Express v5**             | Solid. The async error handling in v5 eliminates a whole class of unhandled promise rejection bugs.                         |
| **pg + squid**             | Excellent. Template tag SQL is the right balance of safety and flexibility.                                                 |
| **Socket.io**              | Good for the feature set. The PostgreSQL adapter enables multi-process scaling.                                             |
| **Tiptap/ProseMirror**     | Right choice for rich text editing. The custom extensions (mentions, channels, commands, emoji) are well-structured.        |
| **TanStack Query + Dexie** | Good combo for optimistic updates and offline capability.                                                                   |
| **LangChain/LangGraph**    | Appropriate for the companion agent graph. The cost tracking integration via `CostTracker` is well-done.                    |
| **Zod**                    | Used consistently for validation. The v4 upgrade is current.                                                                |

---

## 6. Scaling Considerations (1 → 10K Users)

### 6.1 Connection Pooling

The dual-pool design (30 main + 12 listen) is good. At 10K users with typical 5-10% concurrency, you'll need:

- Main pool: 50-100 connections (increase from 30)
- Consider PgBouncer in front of PostgreSQL for connection multiplexing

### 6.2 Outbox Processing

The cursor-lock-based outbox processing is single-writer per handler. This scales vertically (one process handles all events) but not horizontally. At high event volumes:

- Broadcast handler will bottleneck
- Consider partitioning by workspace for horizontal scaling

### 6.3 Embedding Computation

Embedding generation (for messages and memos) is triggered asynchronously via the outbox. At scale, this could create a backlog. The batch embedding support (`embedMany`) is good — ensure the worker processes batches efficiently.

### 6.4 Regional Sharding Readiness

The workspace-scoped design is good preparation. Key considerations:

- Database per region (not per workspace) for operational simplicity
- Cross-region workspace migration will need careful planning
- The no-FK design actually helps here — no cascade constraints to manage across shards

---

## 7. Priority Recommendations

### Before Public Beta (Must Fix)

1. **Add rate limiting** — Install `express-rate-limit`, configure per-endpoint
2. **Fix open redirect** — Validate redirect targets are relative paths
3. **Add security headers** — Install `helmet` middleware
4. **Gate debug endpoints** — Block `/debug/pool` in production
5. **Add outbox cleanup** — Extend CleanupWorker to delete old outbox events
6. **Add stub auth production guard** — Throw if `USE_STUB_AUTH=true` in production

### Soon After Beta (Should Fix)

7. **Restrict CORS** — Set specific origin in production
8. **Drop dead reactions column** — Clean up schema debt
9. **Add AI model health check** — Validate configured models exist on startup
10. **Extend branded ID types** — Cover StreamId, MessageId at minimum

### Future Improvements (Nice to Have)

11. **Reorganize backend lib/** — Group related files into subdirectories
12. **Add memo classification batching** — Reduce AI costs for bursty channels
13. **Add conversation summary for truncated history** — Better long-conversation handling
14. **Persona prompt sandboxing** — Wrap user prompts in system-level guardrails for shared workspaces
15. **Increase connection pool sizes** — Prepare for higher concurrency
16. **Add Zod validation for UserPreferences** — Constrain timezone, language fields

---

## Appendix: Files Examined

This audit examined 200+ files across the full monorepo including all handlers, services, repositories, middleware, auth, AI workflows, migrations, types, frontend components, and configuration. Specific verification was done on security-critical paths (auth, CORS, cookie config, redirect handling, SQL queries, XSS vectors, debug endpoints).
