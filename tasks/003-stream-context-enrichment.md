# 003: Stream Context Enrichment for Companion Agent

## Problem

The companion agent currently receives minimal context about the stream it's responding in - just `type`, `displayName`, and `description`. This isn't enough for the agent to provide contextually appropriate responses.

Different stream types have different context requirements:

- **Scratchpads** are personal, solo-first - context is primarily the conversation itself
- **Channels** are collaborative - members, surrounding threads, and channel purpose matter
- **Threads** exist in a graph - parent context and position in hierarchy matters
- **DMs** are two-party - similar to channels but more focused

## Current State

```typescript
// companion-worker.ts - buildSystemPrompt()
prompt += `\n\nYou are currently in a ${stream.type}`
if (stream.displayName) {
  prompt += ` called "${stream.displayName}"`
}
if (stream.description) {
  prompt += `: ${stream.description}`
}
```

This is the same regardless of stream type.

## Target State

Context-aware system prompt enrichment based on stream type:

### Scratchpads

- Treat conversation history as the primary context
- Messages map directly to `role=user` / `role=assistant`
- No special metadata needed - it's a personal workspace

### Channels

- Include: slug, description, member list (names/roles)
- Surrounding messages: ~20 before, ~10 after the trigger
- Thread summaries (cached) for threads branching from visible messages
- Channel purpose/topic if set

### Threads

- Traverse the graph upward to the root channel
- Each level includes decreasing context:
  - Parent: ~10 surrounding messages
  - Grandparent: ~5 surrounding messages or just the anchor message
  - Root channel: just the channel info
- Include stream membership for each traversed stream
- Position awareness: "This is a reply to [message] in thread [topic] in channel [name]"

### DMs

- Treat like channels initially
- Include both participants' names
- No thread context (DMs don't have threads currently)

## Design

### New Module: `agents/context-builder.ts`

```typescript
interface StreamContext {
  streamType: StreamType
  streamInfo: { name: string; description?: string; slug?: string }
  participants?: { id: string; name: string; role?: string }[]
  conversationHistory: Message[]
  surroundingContext?: {
    before: Message[]
    after: Message[]
  }
  threadContext?: {
    depth: number
    path: Array<{ streamId: string; anchorMessage: Message }>
  }
  threadSummaries?: Map<string, string> // threadId -> cached summary
}

async function buildStreamContext(
  client: PoolClient,
  streamId: string,
  triggerMessageId: string
): Promise<StreamContext>
```

### Context-Aware Prompt Builder

```typescript
function buildSystemPrompt(persona: Persona, context: StreamContext): string
```

Different templates per stream type, incorporating relevant context.

## Implementation Phases

### Phase 1: Scratchpad Context (simplest)

- Extract context building from worker
- Implement scratchpad-specific logic (basically current behavior)
- Add tests

### Phase 2: Channel Context

- Add member list to context
- Add surrounding messages
- Update prompt template for channels

### Phase 3: Thread Context

- Implement graph traversal
- Add hierarchical context loading
- Position awareness in prompts

### Phase 4: Thread Summaries (optional, evaluate value first)

- Cached thread summarization
- Integration with context builder

## Dependencies

- Requires companion agent refactoring from PR #10 (thin worker, agent module)
- Thread graph traversal APIs may need to be added

## Acceptance Criteria

- [ ] Context builder module exists with stream-type-specific logic
- [ ] Scratchpads use conversation-as-context pattern
- [ ] Channels include member info and surrounding messages
- [ ] Threads show position in hierarchy with decreasing context
- [ ] System prompts differ meaningfully by stream type
- [ ] Cached thread summaries (Phase 4) or deferred with clear plan

## References

- PR #10 review comment on `companion-agent.ts:42`
- Future: GAM integration will use similar context for memo extraction
