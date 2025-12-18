# Batch Stream Memberships - Work Notes

**Started**: 2025-12-18
**Branch**: batch-stream-memberships
**Status**: Complete
**Request**: docs/requests/batch-stream-memberships.md

## Problem Statement

The workspace bootstrap handler fetches stream memberships with N+1 queries:

```typescript
// apps/backend/src/handlers/workspace-handlers.ts:76-78
const streamMemberships = await Promise.all(streams.map((stream) => streamService.getMembership(stream.id, userId)))
```

Each `getMembership` call executes a separate database query. For a user with 20 streams, this means 20 round-trips to the database.

## Solution

Add a batch method that fetches all memberships for a user across multiple streams in a single query:

```sql
SELECT * FROM stream_members
WHERE stream_id = ANY($1) AND user_id = $2
```

## Applicable Invariants

- **INV-5**: Repository Pattern - methods take `PoolClient` as first parameter
- **INV-6**: Transactions in Services - services manage transaction boundaries

## Implementation Plan

1. **StreamMemberRepository** - Add `findByStreamsAndUser(client, streamIds, userId)`
2. **StreamService** - Add `getMembershipsBatch(streamIds, userId)`
3. **workspace-handlers.ts** - Replace Promise.all with single batch call

---

## Session Log

### 2025-12-18 - Initial Implementation

**Context reviewed**:

- Read `stream-member-repository.ts` - understood row mapping pattern and `findByStreamAndUser`
- Read `stream-service.ts` - understood `getMembership` wraps repository with `withClient`
- Read `workspace-handlers.ts` - confirmed N+1 pattern at lines 76-78

**Completed**:

- [x] Created work notes document
- [x] Added `findByStreamsAndUser` to StreamMemberRepository
- [x] Added `getMembershipsBatch` to StreamService
- [x] Updated workspace handler to use batch method
- [x] Ran E2E tests - all 36 passing

---

## Key Decisions

### Method naming: `findByStreamsAndUser` vs `listBatch`

**Choice**: `findByStreamsAndUser(client, streamIds, userId)`
**Rationale**: Follows existing naming pattern (`findByStreamAndUser`) and is explicit about what it queries. The plural "Streams" indicates batch behavior.

### Return type: Array vs Map

**Choice**: Return `StreamMember[]` (array), not `Map<string, StreamMember>`
**Rationale**: The handler just filters nulls and returns the array. A Map adds complexity without benefit since we're fetching ONE user's membership per stream (at most one result per stream).

---

## Files Modified

- `apps/backend/src/repositories/stream-member-repository.ts` - Add batch method
- `apps/backend/src/services/stream-service.ts` - Add service wrapper
- `apps/backend/src/handlers/workspace-handlers.ts` - Use batch method
