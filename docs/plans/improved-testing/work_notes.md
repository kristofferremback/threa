# Improved Testing Coverage - Work Notes

**Started**: 2025-12-18
**Branch**: improved-testing
**Status**: In Progress

## Current State Analysis

### Test Coverage Summary

| Area                | Test Files | Lines of Tests | Source Files Without Tests |
| ------------------- | ---------- | -------------- | -------------------------- |
| Backend Unit        | 3          | ~300           | 58                         |
| Backend E2E         | 1          | 612            | -                          |
| Backend Integration | 1          | 445            | -                          |
| Frontend            | 1          | 82             | 91                         |
| **Total**           | 6          | ~1,400         | 149                        |

**Test-to-Source Ratio**: ~5%

### Testing Infrastructure Already in Place

**Backend**:

- Bun's native test runner
- Comprehensive `TestClient` with helpers (login, createWorkspace, createStream, sendMessage, etc.)
- Test server setup with isolated database (`threa_test`)
- Stub auth for E2E testing
- Clear separation: unit (`src/`), integration (`tests/integration/`), E2E (`tests/e2e/`)

**Frontend**:

- Vitest + React Testing Library
- jsdom environment
- Test setup with jest-dom matchers
- Services context pattern allows dependency injection for testing

---

## Recommendations by Priority

### 1. End-to-End Tests (Highest Impact)

The existing E2E test (`tests/e2e/api.test.ts`) is excellent - 58 test cases covering auth, workspaces, streams, messages, reactions. Gaps to fill:

#### 1.1 Companion Agent E2E Flow

**Why**: Core differentiator feature. Currently untested end-to-end.
**What to test**:

- Send message to scratchpad with companion ON → verify AI response appears
- Send message with companion OFF → verify no response
- Send message with companion NEXT_MESSAGE_ONLY → verify one response, then stops
- Concurrent messages → verify session prevents duplicate responses

**Complexity**: Requires mocking LLM responses or using deterministic test model.

#### 1.2 Stream Naming E2E Flow

**Why**: Background worker with locking. Easy to break.
**What to test**:

- Create scratchpad → send messages → verify display name generated
- "NOT_ENOUGH_CONTEXT" handling → verify name stays null
- Concurrent naming attempts → verify locking prevents duplicates

#### 1.3 Real-time Event Broadcasting

**Why**: Outbox pattern is critical infrastructure.
**What to test**:

- Create message → verify Socket.io event received by other clients
- Edit message → verify edit event broadcast
- Add reaction → verify reaction event broadcast
- Archive stream → verify archive event broadcast

**Complexity**: Requires WebSocket test client or polling outbox directly.

#### 1.4 Thread Creation and Nesting

**Why**: Thread support exists but appears untested.
**What to test**:

- Create thread on message → verify parent/root stream tracking
- Nested threads → verify unlimited depth works
- Thread event filtering → verify events scoped correctly

---

### 2. Integration Tests (High Impact)

#### 2.1 Event Sourcing + Projections

**Why**: Core architecture pattern. Bugs here compound across features.
**What to test**:

- Message creation: event appended + projection created + outbox published (all in transaction)
- Message edit: event recorded + projection updated + correct sequence
- Message deletion: soft delete in projection + event records delete
- Reaction add/remove: aggregation in projection stays consistent
- Transaction rollback: verify all-or-nothing behavior

**File**: `tests/integration/event-sourcing.test.ts`

#### 2.2 Stream Access Control

**Why**: Security-sensitive. Currently implicit in E2E but deserves focused tests.
**What to test**:

- Public channel: any workspace member can access
- Private channel: only explicit members can access
- Scratchpad: only creator can access
- DM: exactly two members, both have access
- 404 vs 403 semantics: resource doesn't exist vs. no permission

**File**: `tests/integration/access-control.test.ts`

#### 2.3 Companion Agent Session Lifecycle

**Why**: Complex state machine. Easy to have race conditions.
**What to test**:

- Session created on first message
- Duplicate trigger → returns existing session (idempotent)
- Session marked COMPLETED after success
- Session marked FAILED on error
- Response message linked to trigger message

**File**: `tests/integration/companion-session.test.ts`

#### 2.4 Stream Naming with Locking

**Why**: Pessimistic locking is subtle. Current implementation uses `FOR UPDATE SKIP LOCKED`.
**What to test**:

- Concurrent naming attempts → only one proceeds
- Lock released after completion
- Failed naming doesn't block retries

**File**: `tests/integration/stream-naming.test.ts`

---

### 3. Unit Tests (Targeted High-Value)

Only for isolated units with complex/hairy logic. Following the `relative-time.test.tsx` pattern.

#### 3.1 Backend Unit Tests

**`src/lib/id.ts`** - ID generation and validation

- `generateId()` with prefixes
- `isPrefixedId()` validation
- Edge cases (invalid prefixes, malformed IDs)

**`src/lib/slug.ts`** - Slug generation

- `generateUniqueSlug()` collision handling
- Special character handling
- Length constraints

**`src/repositories/stream-event-repository.ts`** - Sequence generation

- BigInt sequence ordering
- Gap detection (if relevant)

**`src/agents/companion-agent.ts`** - Response generation logic

- Message history truncation (last 20)
- Persona resolution logic
- Skip conditions (companion OFF, persona not found)

_Note_: Most repositories are thin data access - they don't need unit tests. Test them through integration tests.

#### 3.2 Frontend Unit Tests

**`src/lib/draft-id.ts`** - Draft ID utilities

- `generateDraftId()` format
- `isDraftId()` detection
- Edge cases

**`src/lib/actor.ts`** - Actor formatting

- User ID truncation
- AI companion detection
- Display name formatting

**`src/hooks/use-events.ts`** - Event deduplication logic

- Duplicate detection
- Sequence ordering (BigInt)
- Merge logic (bootstrap + paginated)

_Note_: This hook is complex enough that extracting the pure logic into a separate module and unit testing that would be valuable.

**`src/components/timeline/message-input.tsx`** - Draft state machine

- Draft creation → message send → stream conversion
- Error states and retry logic
- Optimistic update rollback

---

## Testing Gaps Analysis

### What's Well Tested

- API endpoint happy paths (E2E)
- Emoji conversion (unit)
- Backoff calculation (unit)
- Provider registry parsing (unit)
- Outbox listener mechanics (integration)
- Relative time formatting (unit)

### What's Missing

| Category        | Gap                            | Risk                          |
| --------------- | ------------------------------ | ----------------------------- |
| **E2E**         | Companion agent flow           | High - core feature           |
| **E2E**         | Real-time events via Socket.io | High - user experience        |
| **E2E**         | Thread creation/nesting        | Medium - feature completeness |
| **Integration** | Event sourcing consistency     | High - data integrity         |
| **Integration** | Access control edge cases      | High - security               |
| **Integration** | Session lifecycle              | Medium - correctness          |
| **Unit**        | ID/slug utilities              | Low - simple but foundational |
| **Frontend**    | Hook logic (useEvents)         | Medium - complex state        |
| **Frontend**    | Draft flow                     | Medium - user experience      |

---

## Implementation Order

Recommended sequence based on risk × effort (updated after legacy doc review):

1. **Event Sourcing Integration Tests** - Foundation for everything else
2. **Real-time Broadcasting E2E (socket.io-client)** - User experience critical, validates outbox → socket flow
3. **Companion Agent E2E** - Core differentiator, MORE complex than initially thought (session lifecycle, recovery, 3 modes)
4. **Access Control Integration Tests** - Security critical (visibility vs membership distinction)
5. **Thread Graph Integration Tests** - Unlimited nesting, parent/root stream tracking
6. **Stream Naming Integration** - Background worker with locking
7. **Frontend useEvents Unit Tests** - Complex hook logic
8. **ID/Slug Unit Tests** - Quick wins, foundational

---

## Insights from Legacy Exploration

Reviewed `docs/legacy-exploration.md` for testing-relevant patterns:

### Companion Agent Complexity (Higher Priority Than Initially Thought)

The legacy doc reveals the companion agent has significant complexity:

1. **Session Lifecycle with Recovery Semantics**
   - Server heartbeat for orphan detection
   - Resume from last checkpoint on server crash
   - Step-level durability (think → tool → tool → respond)
   - Token buffer for client reconnection

2. **Companion Mode States**
   - `off` - AI passive (not responding)
   - `on` - AI responds to messages
   - ~~`next_message_only`~~ - Exists in schema but not implemented. Separate task to clean up.

3. **Persona Resolution Flow**
   - Parse @mention for persona slug
   - Look up workspace-scoped first, then system
   - Fall back to default system persona (Ariadne)
   - Execute with that persona's config (model, tools, prompt)

### Thread Graph Structure

Threads are streams with unlimited nesting depth:

- `parent_stream_id` → immediate parent (can be channel OR another thread)
- `root_stream_id` → non-thread ancestor (visibility source)
- Visibility inherited from root, membership tracked separately

**Test cases**:

- Create thread on message in channel
- Create nested thread (thread on thread)
- Verify visibility = root stream membership
- Verify participation tracking

### Visibility vs Membership Distinction

| Concept       | Who                                       | Determined By                |
| ------------- | ----------------------------------------- | ---------------------------- |
| **Can view**  | All members of root stream                | `root_stream_id` membership  |
| **Is member** | Participated (replied, reacted, followed) | Explicit in `stream_members` |

This distinction matters for notifications, search, unread counts.

### Event Types to Test

From the legacy doc's event schema:

- `message_created`, `message_edited`, `message_deleted`
- `reaction_added`, `reaction_removed`
- `member_joined`, `member_left`
- `thread_created`
- `agent_session_started`, `agent_session_step`, `agent_session_completed`

Each event type should have projection update tests.

### What Legacy Got Wrong (Avoid in Tests)

- "God Service" (76KB StreamService) - test services independently
- Inline SQL in socket handler - verify we use services/repos
- No frontend tests - we're fixing this

---

## Technical Notes

### Mocking LLM for Companion Tests

Options:

1. **Stub model provider** - Return deterministic responses
2. **Record/replay** - Capture real responses, replay in tests
3. **Test-specific model** - `test:echo` that echoes input

Recommendation: Stub model provider that returns configurable responses. Add to `ModelRegistry` as `test:stub`.

### WebSocket Testing

Options:

1. **socket.io-client in tests** - Connect and verify events
2. **Outbox polling** - Query outbox table directly, verify events inserted
3. **Mock socket** - Unit test event emission

**Decision**: Use socket.io-client for true E2E confidence. Outbox polling tests the wrong layer - we care that clients receive events, not that rows exist in a table.

### Frontend Testing Strategy

Options:

1. **Component tests** - Render components, verify behavior
2. **Hook tests** - Use `renderHook` for custom hooks
3. **Integration tests** - Full page rendering with mocked API

Recommendation:

- Extract pure logic from hooks → unit test
- Component tests for user interactions
- Skip full page integration (E2E covers this better)

---

## Session Log

### 2025-12-18 - Initial Exploration

**Context reviewed**:

- Explored all existing test files and infrastructure
- Analyzed backend services, handlers, repositories
- Analyzed frontend pages, components, hooks

**Applicable invariants**: INV-4 (Outbox), INV-5 (Repository Pattern), INV-6 (Transactions in Services), INV-7 (Events + Projections)

**Completed**:

- [x] Inventory existing tests
- [x] Identify gaps by category (E2E, integration, unit)
- [x] Prioritize by risk × impact
- [x] Document recommendations

**Discovered**:

- Test infrastructure is solid - `TestClient` helpers comprehensive
- E2E tests cover happy paths well, but miss background workers
- Event sourcing + projections is core architecture but only tested implicitly
- Frontend has sophisticated state management but minimal tests

**Next steps**:

1. Get Kris's input on priorities
2. Start with highest-impact area (likely event sourcing integration tests)
3. Expand E2E to cover companion agent flow

---

## Key Decisions

_None yet - awaiting prioritization input_

---

## Open Questions

- [ ] Should companion agent tests use a stub model or mock the entire LLM layer?
- [x] ~~Is WebSocket testing via socket.io-client worth the complexity?~~ **Yes** - use socket.io-client for true E2E confidence
- [ ] Any specific failure modes Kris has observed that should inform test cases?

---

## Files Modified

_None yet - exploration phase_
