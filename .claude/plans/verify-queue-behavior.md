# Queue Worker Starvation

## Goal

Prevent the revamped queue scheduler from starving fresh interactive work when an existing worker token hangs, and add enough observability to spot a wedged queue token before users have to restart the server.

## What Was Built

### Queue polling lifecycle

The queue manager now keeps polling on the normal cadence even while tokens are still in flight. This removes the cycle-level dependency on every active token finishing before later-arriving work can be leased.

The tier refill path now also tracks whether a fill is already in progress, so the new overlapping polling cadence cannot double-lease a tier while a prior lease query is still running.

**Files:**
- `apps/backend/src/lib/queue/manager.ts` - Removes cycle draining as a prerequisite for the next poll and adds a per-tier `fillInProgress` guard.

### Hung-token observability

Queue tokens now emit a one-shot warning if they run past a configurable threshold and increment a dedicated Prometheus counter tagged by queue and workspace.

This is intentionally lightweight: it surfaces suspiciously long-lived tokens without changing queue semantics or trying to auto-recover them.

**Files:**
- `apps/backend/src/lib/queue/manager.ts` - Starts and clears a stuck-token warning timer per token.
- `apps/backend/src/lib/observability/metrics.ts` - Adds the `queue_tokens_stuck_total` counter.
- `apps/backend/src/lib/observability/index.ts` - Re-exports the new queue metric.

### Regression coverage

The test suite now includes the reported failure mode directly: one interactive token blocks, a second job arrives later, and that later job must still run. A focused unit test also verifies the stuck-token warning path.

**Files:**
- `apps/backend/tests/integration/queue-manager.test.ts` - Adds the starvation regression test for later interactive work.
- `apps/backend/src/lib/queue/manager.test.ts` - Adds the stuck-token warning unit test.

## Design Decisions

### Continue polling while tokens are active

**Chose:** Schedule the next queue polling cycle after cron processing instead of waiting for all active tokens to finish.
**Why:** Waiting for cycle drain made one hung token equivalent to a globally stalled scheduler for that tier, which matches the scratchpad starvation symptom that was reported.
**Alternatives considered:** Keeping the old cycle barrier and relying only on debounced refill was rejected because no refill happens when a token never completes.

### Keep the fix in the scheduler, not in persona-specific code

**Chose:** Fix the starvation in `QueueManager` instead of special-casing `persona.agent`.
**Why:** The failure mode is structural. Any queue using the tiered scheduler could be starved by a hung token if polling is blocked behind cycle completion.
**Alternatives considered:** Adding persona-specific retries or watchdog logic would treat the symptom in one queue but leave the scheduler bug intact.

### Surface hung tokens with a warning and counter

**Chose:** Add one-shot observability for long-lived tokens.
**Why:** Long-running tokens can be legitimate, but a thresholded warning plus metric is enough to flag suspicious cases without introducing automatic cancellation or retry behavior.
**Alternatives considered:** Automatic token termination was deferred because it is harder to do safely and could break legitimately long-running work.

## Design Evolution

- **Starvation diagnosis:** Initial investigation started from the new tier/fairness work, but the root cause turned out to be the polling-cycle barrier rather than the `QueueFairness.NONE` leasing mode.
- **Observability follow-up:** After fixing the scheduler stall, the scope expanded slightly to add a minimal stuck-token signal so similar incidents are easier to detect in production.

## Schema Changes

None.

## What's NOT Included

- A strict per-message priority field or database-backed priority ordering.
- Automatic cancellation or forced recovery of hung workers.
- Changes to queue fairness policy beyond the scheduler starvation fix.

## Status

- [x] Reproduce the interactive starvation case with an integration regression test.
- [x] Allow later polling cycles to lease fresh work while existing tokens are still running.
- [x] Guard tier refills against overlapping lease attempts.
- [x] Add queue stuck-token warning and counter instrumentation.
- [x] Verify with queue unit tests, queue integration tests, and backend typecheck.
