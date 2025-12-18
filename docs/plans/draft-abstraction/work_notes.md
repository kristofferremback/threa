# Draft Abstraction Layer - Work Notes

**Started**: 2025-12-18
**Branch**: draft-abstraction
**Status**: Complete

## Session Log

### 2025-12-18 - Initial Analysis & Design

**Context reviewed**:

- Read `docs/requests/draft-abstraction.md` - understood the problem statement and proposed solutions
- Read `apps/frontend/src/components/layout/sidebar.tsx` - found `isDraft` checks at lines 219-224 (rename) and 226-231 (archive)
- Read `apps/frontend/src/pages/stream.tsx` - found `isDraft` checks at lines 59-63 (rename) and 66-71 (archive)
- Read `apps/frontend/src/components/timeline/message-input.tsx` - found draft promotion logic at lines 72-98
- Read `apps/frontend/src/components/timeline/timeline-view.tsx` - found `isDraft` used to disable socket/events
- Read `apps/frontend/src/hooks/use-draft-scratchpads.ts` - understood draft storage in IndexedDB
- Read `apps/frontend/src/hooks/use-streams.ts` - understood real stream hooks
- Read `apps/frontend/src/db/database.ts` - understood data model

**Applicable invariants**: None directly applicable (this is frontend-only)

**Current State Analysis**:

Drafts and real streams have fundamentally different storage:

- **Drafts**: IndexedDB (`draftScratchpads` table), IDs start with `draft_`
- **Real streams**: Server-side PostgreSQL, cached in IndexedDB (`streams` table)

Places where `isDraft` conditionals exist:

| File                | Lines   | Operation          | Draft Path                            | Real Path                    |
| ------------------- | ------- | ------------------ | ------------------------------------- | ---------------------------- |
| `sidebar.tsx`       | 219-224 | Rename             | `onRename(trimmed)` → `updateDraft()` | `updateStream.mutateAsync()` |
| `sidebar.tsx`       | 226-231 | Archive            | `onArchive()` → `deleteDraft()`       | `deleteStream.mutateAsync()` |
| `stream.tsx`        | 59-63   | Rename             | `updateDraft()`                       | `updateStream.mutateAsync()` |
| `stream.tsx`        | 66-71   | Archive            | `deleteDraft()`                       | `deleteStream.mutateAsync()` |
| `message-input.tsx` | 72-98   | Send first message | Create stream + send + delete draft   | Regular message send         |
| `timeline-view.tsx` | 17-23   | Load events        | Skip (no events yet)                  | `useEvents()` + socket       |
| `timeline-view.tsx` | 74-78   | Display            | "Start typing..."                     | `EventList`                  |

**Discovered**:

1. The two proposed solutions (unified hook vs promotion service) aren't mutually exclusive - we need both:
   - A unified interface for CRUD operations (rename, archive)
   - Promotion logic for converting draft to real stream on first message

2. Current hook structure is well-organized - we can create `useVirtualStream` that composes:
   - `useDraftScratchpads` for draft operations
   - `useUpdateStream` / `useDeleteStream` for real stream operations
   - `isDraftId()` helper already exists

3. The timeline behavior difference (no events for drafts) is intentional and should remain - drafts have no server-side events

**Next steps**:

1. Design the `useVirtualStream` hook interface
2. Implement the hook
3. Migrate `sidebar.tsx` ScratchpadItem component
4. Migrate `stream.tsx` StreamPage component
5. Consider if message-input.tsx promotion logic should be part of the abstraction

---

### 2025-12-18 - Implementation Complete

**Completed**:

- [x] Created `useStreamOrDraft` hook with unified interface
- [x] Migrated `stream.tsx` to use hook (removed 5 imports, simplified handlers)
- [x] Migrated `sidebar.tsx` - `ScratchpadItem` now self-contained with hook
- [x] Migrated `message-input.tsx` - uses `sendMessage` for seamless draft promotion
- [x] Added shadcn Empty component for draft timeline state
- [x] Build passes

**Changes made**:

- New file: `apps/frontend/src/hooks/use-stream-or-draft.ts`
- Modified: `apps/frontend/src/hooks/index.ts` (exports)
- Modified: `apps/frontend/src/pages/stream.tsx`
- Modified: `apps/frontend/src/components/layout/sidebar.tsx`
- Modified: `apps/frontend/src/components/timeline/message-input.tsx`
- Modified: `apps/frontend/src/components/timeline/timeline-view.tsx`
- New file: `apps/frontend/src/components/ui/empty.tsx` (shadcn component)

---

## Design

### Option 1: Unified Hook (Selected)

```typescript
interface VirtualStream {
  id: string
  displayName: string | null
  type: StreamType
  isDraft: boolean
  companionMode?: CompanionMode
  // ... other common fields
}

interface UseVirtualStreamReturn {
  stream: VirtualStream | undefined
  isLoading: boolean

  // Unified operations
  rename: (newName: string) => Promise<void>
  archive: () => Promise<void>

  // Draft-specific (for message-input promotion)
  promoteToPersistent: (firstMessage: { content: string; contentFormat: string }) => Promise<string>
}

function useVirtualStream(workspaceId: string, streamId: string): UseVirtualStreamReturn
```

### Interface Design Decisions

1. **Stream data**: Return a `VirtualStream` that normalizes the shape between draft and real stream
2. **Operations return void**: Mutations don't need to return data - UI will react to state changes
3. **promoteToPersistent**: Returns the new stream ID so caller can navigate
4. **Keep `isDraft` exposed**: Components may still need it for UI hints (e.g., "(draft)" label)

### Implementation Approach

1. Create `apps/frontend/src/hooks/use-virtual-stream.ts`
2. Hook internally uses:
   - `isDraftId(streamId)` to determine mode
   - `useDraftScratchpads` for draft operations
   - `useStreamBootstrap` for real stream data
   - `useUpdateStream` / `useDeleteStream` for real stream mutations
3. Export from `hooks/index.ts`
4. Migrate components one at a time

---

## Key Decisions

### Hook Name: `useVirtualStream`

**Choice**: `useVirtualStream` over `useStream`
**Rationale**: `useStream` already exists and fetches real streams. "Virtual" communicates that this abstracts over drafts and real streams.
**Alternatives considered**: `useUnifiedStream`, `useStreamOrDraft`, `useAbstractStream`

### Promotion Logic Location

**Choice**: Include in the hook as `promoteToPersistent()`
**Rationale**: The promotion flow (create stream → send message → delete draft) is tightly coupled. Having it in the hook keeps all draft→real transitions in one place.
**Alternatives considered**: Keep in message-input.tsx (current), separate service

---

## Blockers / Open Questions

- [ ] Should `timeline-view.tsx` also use this hook? Currently it uses `isDraft` prop. The hook could provide `hasEvents` or similar.

---

## Files to Modify

- `apps/frontend/src/hooks/use-virtual-stream.ts` - **NEW** - the abstraction layer
- `apps/frontend/src/hooks/index.ts` - export the new hook
- `apps/frontend/src/components/layout/sidebar.tsx` - use `useVirtualStream` in `ScratchpadItem`
- `apps/frontend/src/pages/stream.tsx` - use `useVirtualStream`
- `apps/frontend/src/components/timeline/message-input.tsx` - use `promoteToPersistent`
- `apps/frontend/src/components/timeline/timeline-view.tsx` - potentially use hook for `isDraft` check
