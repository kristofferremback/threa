# Prioritize Real-Time Message Delivery Over Background Work

## Context

A burst of messages (generated during testing) caused the socket.io broadcast path to fall behind and slowly catch up while AI/background work was running. The user wants real-time delivery (socket broadcast + push notifications) to be effectively immune to background load: AI jobs, embeddings, link unfurls, PDF/image captioning etc. can wait, but message delivery cannot.

This plan also revisits per-workspace queue sharding, since the region-level sharding already provides workspace isolation at the infrastructure layer, and per-workspace token leasing can hurt single-workspace burst throughput.

## Key finding: broadcast and push are NOT in the job queue

Before picking a fix, an important clarification about the current architecture (verified against code):

- **Job queue** (`QueueManager`, `apps/backend/src/lib/queue/manager.ts:64`) handles ~16 background job kinds: `persona.agent`, `embedding.generate`, `naming.generate`, `boundary.extract`, `memo.*`, `image.caption`, `pdf.*`, `text/word/excel.process`, `avatar.process`, `link_preview.extract`, `command.execute`. Configured at `server.ts:211` with `maxActiveTokens=3`, `processingConcurrency=3` → max 9 concurrent handlers total, shared across all queues.
- **Outbox handlers** (`packages/backend-common/src/outbox/dispatcher.ts:66`) are a separate path. Each handler has its own cursor lock + debouncer and is notified via a single LISTEN connection.
- `BroadcastHandler` (`apps/backend/src/lib/outbox/broadcast-handler.ts:55`) — socket.io fan-out. `debounceMs=10`, `maxWaitMs=50`, `batchSize=100`. **Not a queue job.**
- `PushNotificationHandler` (`apps/backend/src/features/push/outbox-handler.ts:35`) — web-push delivery. `debounceMs=50`, `maxWaitMs=200`, `batchSize=10`. **Also an outbox handler, not a queue job.**

So the real-time path is already structurally independent of the job queue. Under burst load, the actual causes of broadcast lag are almost certainly:

1. **Main DB pool contention (`pools.main`, 30 conns).** Everything shares it: HTTP handlers, queue workers (up to 9 concurrent, some holding conns during LLM writes), the socket.io PG adapter (`io.adapter(createAdapter(pool))` at `server.ts:393`), 15 outbox handlers' `fetchAfterId` + cursor operations, retention worker, session cleanup. When AI workers saturate the pool, broadcast's tiny fetch queries queue up.
2. **Event loop pressure.** Queue handlers and outbox handlers run in the same Node process. CPU-heavy work (JSON parse/stringify of large payloads, markdown parsing, tokenization) delays the broadcast debouncer's timers.
3. **Cursor-lock query amplification.** Each handler polls DB on every notify. 15 handlers × burst of notifies = thundering herd on the main pool.
4. **Per-workspace queue sharding** amplifies queue backlog (not broadcast lag directly), because a single workspace generating 100 persona.agent jobs can only run 1 token × 3 concurrent = 3 at a time, regardless of idle capacity.

The user's framing ("weight queue workers toward delivery") is the right instinct, but the fix lives in three places: (a) isolate real-time DB/pool resources, (b) add explicit priority + per-queue concurrency caps for background work, (c) relax workspace sharding.

## Approach

Confirmed with user: dedicated realtime DB pool + tiered queue concurrency + per-queue opt-in workspace fairness (default off). Single-process, no architectural split.

### 1. Give real-time outbox handlers a dedicated DB pool

Add a third pool `pools.realtime` (e.g. `max: 8`) alongside `main` (30) and `listen` (12). Use it exclusively for `BroadcastHandler` and `PushNotificationHandler` — for both their cursor-lock operations and their `fetchAfterId` queries. Queue workers, HTTP handlers, and the socket.io PG adapter continue to use `pools.main`.

Result: a saturated main pool (AI workers holding 20+ conns writing results, running transactions, etc.) can no longer block the broadcast fetch. The real-time path has permanently reserved DB capacity.

- New pool creation: `packages/backend-common/src/db/index.ts:91` (`createDatabasePools`)
- Wire into handlers: `apps/backend/src/server.ts:564` (broadcastHandler) and `577` (pushNotificationHandler)
- Pass `pools.realtime` into `BroadcastHandler` constructor and its internal `CursorLock` + `OutboxRepository.fetchAfterId` call (`broadcast-handler.ts:64-97`). Same for push.
- Update `PoolMonitor` registration at `server.ts:157` to include the new pool.

### 2. Introduce per-queue concurrency budgets + tiered prioritization

Extend `QueueManager` (`apps/backend/src/lib/queue/manager.ts:64`) so each registered queue declares a **tier** and a **max-in-flight cap**, not a single global `maxActiveTokens`. Example config at `server.ts:211`:

```ts
// pseudo
tiers: {
  interactive: { maxActiveTokens: 6 },   // persona.agent, command.execute
  light:       { maxActiveTokens: 6 },   // naming, link_preview, embedding (fast)
  heavy:       { maxActiveTokens: 3 },   // pdf.*, word/excel, image.caption, memo.*
}
// total worst-case: 15 tokens × 3 msgs = 45 handlers, but bounded per tier
```

Token leasing in `TokenPoolRepository.batchLeaseTokens` (`apps/backend/src/lib/queue/token-pool-repository.ts:93`) changes to lease per-tier, not globally. Each tier has its own in-flight accounting in `QueueManager.cycle` (`manager.ts:290`). The token table schema already supports this — no migration needed if we just encode tier in the selection query (filter by queue name sets).

Benefits:
- **Interactive** work (persona.agent / command) is no longer starved behind a PDF upload that queued 50 pdf.process_page jobs.
- **Heavy** tier is capped so it can't monopolize DB connections and block everything else.
- **Light** tier (embeddings, link previews) can run with higher parallelism since each job is fast.

This does not affect broadcast or push directly — they're outside the queue — but it does lower the indirect pressure queue workers put on `pools.main`, the event loop, and LLM budgets, which is what currently causes broadcast lag.

### 3. Relax workspace sharding: opt-in, not default

Per-workspace token leasing is currently mandatory (`token-pool-repository.ts:93-167` leases per `(queue_name, workspace_id)`). Since region-level sharding already isolates tenants, the only reason to keep workspace fairness is to prevent one workspace from starving others on the same instance — which matters in a multi-tenant region but is pure overhead for solo workspaces.

Change to: **per-queue config flag `fairness: "workspace" | "none"`**, default `"none"` for most queues.

- `fairness: "none"` — token leases per `queue_name` only; a single workspace can run up to the tier's full parallelism. Correct default for `persona.agent`, `embedding.generate`, `naming.generate`, `link_preview.extract`, `command.execute`, attachment pipelines.
- `fairness: "workspace"` — current behavior; keep for queues that could be abused by a single workspace (e.g. `memo.batch-process`, heavy LLM fanout) or remove entirely if we trust rate limits.

Implementation: add a `fairness_mode` column or, simpler, keep it in-memory as part of queue handler registration. The `batchLeaseTokens` CTE selects either `GROUP BY queue_name, workspace_id` or `GROUP BY queue_name` based on the queue's declared mode.

Result: a single workspace generating a burst of messages (the user's scenario) can now use the full `interactive` tier budget, so AI replies catch up in seconds instead of minutes, which in turn shortens the window during which the queue puts pressure on `pools.main`.

### 4. Keep — don't add — prioritization for the broadcast path itself

Broadcast already has the fastest debounce (10ms) of any handler and its own cursor lock. Once step 1 isolates it from pool contention, it should not fall behind. We explicitly do **not** add a priority mechanism inside the dispatcher — it correctly fire-and-forgets each handler in parallel, and all handlers are independent cursors. Simpler is better here.

### 5. Minor supporting changes

- **Push batch size**: `PushNotificationHandler.batchSize` is 10 because web-push is network I/O. That's fine for throughput but means under load the handler loops. Consider increasing `maxWaitMs` tolerance is NOT needed; leave as-is. Do, however, parallelize per-event `deliverPushForActivity` within a batch (currently sequential `await` in `push/outbox-handler.ts:86-114`). `Promise.allSettled` over the batch, bounded to e.g. 5 in flight, would cut push latency under burst.
- **Observability**: add per-tier in-flight gauges and a broadcast lag metric (now - max outbox id processed vs now - max outbox id inserted) exposed via `PoolMonitor` or a new metrics endpoint, so we can verify the fix under synthetic burst load.

## Files to modify

- `packages/backend-common/src/db/index.ts` — add `realtime` pool to `createDatabasePools` and `DatabasePools` type.
- `apps/backend/src/server.ts` — construct realtime pool; pass it to `BroadcastHandler` and `PushNotificationHandler`; register in `PoolMonitor`; wire new tier config into `QueueManager`.
- `apps/backend/src/lib/outbox/broadcast-handler.ts` — accept injected pool (already takes `db: Pool`, just pass the realtime pool from server.ts). No structural change.
- `apps/backend/src/features/push/outbox-handler.ts` — same as broadcast; parallelize per-event delivery within a batch.
- `apps/backend/src/lib/queue/manager.ts` — replace single `maxActiveTokens` with per-tier budgets; thread tier through `cycle`/`refill`.
- `apps/backend/src/lib/queue/job-queue.ts` — add tier + fairness metadata to handler registration.
- `apps/backend/src/lib/queue/token-pool-repository.ts` — parameterize `batchLeaseTokens` on tier filter and fairness mode.
- `apps/backend/src/lib/queue/repository.ts` — no schema change required if tier is inferred from queue name at lease time.

## Verification

1. **Unit / integration tests**
   - New test: `QueueManager` respects per-tier concurrency caps (spin up 20 heavy + 20 interactive jobs, assert that heavy never exceeds its cap while interactive drains).
   - New test: fairness=none lets a single workspace use full tier budget.
   - Update existing queue tests to use tiered config.
2. **Broadcast isolation test**
   - Integration test: saturate `pools.main` by holding 30 connections in `SELECT pg_sleep(5)`; assert `BroadcastHandler` still fetches and emits events within <100ms using the realtime pool.
3. **Load test (manual)**
   - Reproduce the original scenario: script that posts 200 messages to a stream in 5 seconds while persona.agent + embedding + link_preview queues are active. Measure:
     - Time from outbox insert → socket.io emit (p50/p95/p99). Target: p99 < 150ms.
     - Queue backlog drain time for interactive tier. Target: back to zero within 2× LLM call time.
   - Run once before changes, once after.
4. `bun run test` and `bun run test:e2e` must stay green.

## Out of scope

- Splitting the backend into separate real-time vs worker processes. Revisit only if steps 1–3 don't hold under load testing.
- Replacing the custom PG queue with an external broker.
- Changing the outbox dispatcher's fan-out model.
- Adding priority *inside* the broadcast dispatcher — it's already the lowest-debounce handler; isolating its DB resources is the fix.
