# Batch Endpoint for Stream Memberships

## Problem Statement

The workspace bootstrap handler fetches stream memberships with N+1 queries:

```typescript
// apps/backend/src/handlers/workspace-handlers.ts:76
const streamMemberships = await Promise.all(streams.map((s) => streamService.getMembers(s.id)))
```

While `Promise.all` parallelizes the queries, this still creates N database round-trips.

## Proposed Solution

Add a batch endpoint to fetch memberships for multiple streams at once:

```typescript
// New method in StreamService
async getMembersBatch(streamIds: string[]): Promise<Map<string, StreamMember[]>>

// Or modify getMembers to accept array
async getMembers(streamIds: string | string[]): Promise<StreamMember[] | Map<string, StreamMember[]>>
```

## Implementation Steps

1. Add `getMembersBatch` method to `StreamRepository`
2. Single SQL query with `WHERE stream_id = ANY($1)`
3. Group results by stream_id in application code
4. Update `StreamService` to expose the batch method
5. Update workspace bootstrap handler to use batch method

## SQL Example

```sql
SELECT * FROM stream_members
WHERE stream_id = ANY($1)
ORDER BY stream_id, created_at
```

## Acceptance Criteria

- [ ] Single database query for all stream memberships
- [ ] Workspace bootstrap uses batch method
- [ ] No regression in API response format
