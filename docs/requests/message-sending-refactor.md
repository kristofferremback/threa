# Message Sending Refactor

## Problem Statement

The `MessageInput` component contains a full mutation that handles:
- Draft detection and promotion
- Optimistic updates with IndexedDB
- Query cache updates
- Error handling and retry state
- Navigation after draft promotion

This is "a full service within a component" - the logic should be extracted to be more testable, reusable, and maintainable.

## Proposed Solution

Extract message sending logic into a dedicated service or hook.

### Option 1: Message Sending Service

```typescript
// services/message-sender.ts
export const messageSender = {
  send: async (params: {
    workspaceId: string
    streamId: string
    content: string
    isDraft: boolean
  }) => {
    // All the logic currently in the mutation
    // Returns { success: true, newStreamId?: string } or throws
  }
}
```

### Option 2: useSendMessage Hook

```typescript
// hooks/use-send-message.ts
export function useSendMessage(workspaceId: string, streamId: string) {
  // Encapsulates all mutation logic
  return {
    send: (content: string) => { ... },
    isPending: boolean,
    error: Error | null,
  }
}
```

## Related Work

This refactor could be combined with the draft abstraction work (see `draft-abstraction.md`). If we have a unified stream abstraction, message sending could be:

```typescript
const stream = useStream(workspaceId, streamId)
await stream.sendMessage(content) // Handles draft promotion internally
```

## Implementation Steps

1. Extract mutation logic to dedicated module
2. Add proper TypeScript interfaces
3. Add unit tests for the service
4. Update MessageInput to use the extracted service
5. Ensure optimistic updates still work

## Acceptance Criteria

- [ ] Message sending logic is testable in isolation
- [ ] MessageInput component is simplified
- [ ] Optimistic updates still work
- [ ] Draft promotion still works
- [ ] Error handling is preserved
