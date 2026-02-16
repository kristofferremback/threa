# Broken Integration Tests

**Date:** 2026-02-16
**Status:** Open — partial fix applied, 87 failures remain
**Priority:** Medium — not blocking CI, but tests are silently rotting

## Problem

The `tests/integration/` directory has 87 failing tests across 13 suites. These broke during the feature colocation restructuring (INV-51) and the INV-50 member ID migration, but nobody noticed because **they aren't in any CI pipeline**.

### Why CI doesn't catch this

| Script             | Pattern                       | What it runs                      |
| ------------------ | ----------------------------- | --------------------------------- |
| `test:unit`        | `src/`                        | Unit tests colocated with source  |
| `test:integration` | `tests/integration/critical/` | Only the `critical/` subdirectory |
| `test:e2e`         | `tests/e2e/`                  | E2E tests (need running server)   |

The non-critical `tests/integration/*.test.ts` files are only run via manual `bun test` from the backend directory. No CI job picks them up.

## What was fixed (this branch)

1. **17 files — stale import paths**: All `../../src/repositories/`, `../../src/services/`, `../../src/agents/`, `../../src/lib/job-queue`, `../../src/lib/boundary-extraction/` imports updated to new feature-colocated barrel paths (`../../src/features/<name>/`, `../../src/lib/queue/`).

2. **9 files — `WorkspaceRepository.addMember()` API change**: Old positional args `(client, wsId, userId)` replaced with `addTestMember(client, wsId, userId)` helper in `setup.ts` that wraps `MemberRepository.insert()` with sensible defaults.

3. **1 file — `outbox-repository.test.ts` isolation bug**: `deleteRetainedEvents` tests were picking up pre-existing outbox rows via `ORDER BY id LIMIT N`, causing wrong remaining counts. Fixed by clearing outbox within the test transaction.

## What still needs fixing (87 failures)

### Category 1: Schema changes from INV-50 member migration (~8 tests)

- `stream_members.user_id` no longer exists → renamed to `member_id`
- `reactions` table now requires `member_id` — tests insert reactions without it

**Files:** `trigram-search.test.ts`, `stream-persona-participants.test.ts`, `event-sourcing.test.ts`

### Category 2: Server-required tests (5 tests)

`tests/integration/critical/security-regression.test.ts` needs a running backend on port 3001. These pass in CI via `test:integration` which starts the server. Not broken, just can't run standalone.

### Category 3: Cascading assertion failures (~74 tests)

Most remaining failures are downstream of categories 1-2. Once the schema references are fixed, many will resolve. Suites affected:

- `Access Control` — likely member_id propagation
- `Thread Graph` — member_id in stream operations
- `ConversationRepository` — member_id in participant tracking
- `Event Sourcing` — reaction member_id
- `Context Builder` — member_id in context building
- `User Preferences` — possibly separate API change
- `TokenPoolRepository` — possibly separate issue
- `QueueRepository` — possibly separate issue
- `Unread Counts` — member_id in read state
- `Memo Repositories` — possibly cascading

## Recommended fix approach

1. **Add `tests/integration/` to CI** — either expand `test:integration` pattern or add a new CI step. This is the root cause of the rot.

2. **Fix member_id schema changes** — grep for `user_id` in `tests/integration/`, update to `member_id`. Add helper to `setup.ts` similar to `addTestMember` for reactions/stream members.

3. **Fix remaining API changes** — run each suite individually, fix errors one category at a time. Most will be mechanical (same pattern repeated across files).

4. **Consider test helper expansion** — `setup.ts` already has `addTestMember`, `testMessageContent`, `withTestTransaction`. Adding helpers for common operations (create stream, add reaction, etc.) would make tests resilient to future API changes.

## Reproduction

```bash
cd apps/backend
bun test ./tests/integration/  # 198 pass, 87 fail
```
