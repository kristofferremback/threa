# Draft Abstraction Layer

## Problem Statement

Draft vs non-draft handling is scattered throughout the codebase. Components need to check `isDraft` and handle both cases, which is error-prone and creates code duplication.

Example from `sidebar.tsx`:

```typescript
if (isDraft) {
  onRename(trimmed)
} else {
  await updateStream.mutateAsync({ displayName: trimmed })
}
```

This pattern repeats in:

- `sidebar.tsx` - rename, archive, display name
- `message-input.tsx` - create stream from draft on first message
- `stream.tsx` - header display, title editing

## Proposed Solution

Create a unified "virtual stream" abstraction that handles both drafts and real streams transparently.

### Option 1: Unified Stream Hook

```typescript
// Combines draft and real stream into one interface
function useStream(workspaceId: string, streamId: string) {
  const isDraft = streamId.startsWith("draft_")

  // Returns unified interface regardless of draft status
  return {
    stream: { id, displayName, type, ... },
    rename: async (name: string) => { ... },
    archive: async () => { ... },
    sendMessage: async (content: string) => { ... },
    isDraft,
  }
}
```

### Option 2: Draft-to-Real Promotion Service

```typescript
// Service that handles the draft lifecycle
const draftService = {
  create: (workspaceId, type) => { ... },
  update: (draftId, data) => { ... },
  promote: async (draftId, firstMessage) => {
    // Creates real stream, sends message, deletes draft
    // Returns new stream ID
  },
  delete: (draftId) => { ... },
}
```

## Implementation Steps

1. Design the unified interface
2. Create the abstraction layer (hook or service)
3. Migrate components to use the unified API
4. Remove scattered `isDraft` checks
5. Update tests

## Acceptance Criteria

- [ ] Components don't need to check `isDraft` for common operations
- [ ] Rename works transparently for both drafts and real streams
- [ ] Archive works transparently for both
- [ ] Message sending handles draft promotion automatically
- [ ] Less code duplication across components
