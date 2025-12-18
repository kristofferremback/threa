# 004: Agent Message Tool (createMessage as Tool)

## Problem

Currently, the companion worker posts exactly one response message after the agent completes:

```typescript
// companion-worker.ts
const result = await runCompanionGraph(...)
const responseMessage = await createMessage({
  workspaceId: stream.workspaceId,
  streamId,
  authorId: persona.id,
  authorType: AuthorTypes.PERSONA,
  content: result.response,
})
```

This is inflexible:

1. **Agent can't choose silence** - Sometimes the right response is no response
2. **Agent can't send multiple messages** - Can't break up long responses or send follow-ups
3. **Agent can't delay responses** - Can't "think" and then respond later
4. **No tool-use patterns** - Agent can't demonstrate tool usage by posting intermediate results

## Target State

`createMessage` becomes a tool the agent can invoke:

```typescript
// Agent receives this tool definition
{
  name: "send_message",
  description: "Send a message to the current stream. Use when you want to respond to the user. You may call this multiple times or not at all.",
  parameters: {
    content: { type: "string", description: "The message content" }
  }
}
```

The agent can then:

- Choose not to respond (return without calling the tool)
- Send one message (call once)
- Send multiple messages (call multiple times)
- Mix tool calls with reasoning (post partial results, then continue)

## Design

### Tool Definition

```typescript
// agents/tools/message-tool.ts
interface MessageToolConfig {
  streamId: string
  workspaceId: string
  personaId: string
  createMessage: CreateMessageFn
}

function createMessageTool(config: MessageToolConfig): Tool {
  return {
    name: "send_message",
    description: "Send a message to the current conversation...",
    parameters: z.object({
      content: z.string().describe("The message content to send"),
    }),
    execute: async ({ content }) => {
      const msg = await config.createMessage({
        workspaceId: config.workspaceId,
        streamId: config.streamId,
        authorId: config.personaId,
        authorType: AuthorTypes.PERSONA,
        content,
      })
      return { messageId: msg.id, status: "sent" }
    },
  }
}
```

### Integration with LangGraph

The tool is passed to the graph at invocation time:

```typescript
// companion-agent.ts (after refactor)
const tools = [
  createMessageTool({
    streamId,
    workspaceId: stream.workspaceId,
    personaId: persona.id,
    createMessage: deps.createMessage,
  }),
  // Future: more tools (search_knowledge, create_memo, etc.)
]

const result = await graph.invoke({
  messages,
  systemPrompt,
  tools,
})
```

### Session Tracking Changes

Currently we track `responseMessageId` on the session. With multiple messages possible:

```typescript
// Option A: Track all message IDs
responseMessageIds: string[]  // Array of posted messages

// Option B: Don't track message IDs, just completion
// Messages are linked to session via trigger_message_id lookup if needed

// Option C: First message is "primary", others are "follow-ups"
responseMessageId: string | null  // Primary response
followUpMessageIds: string[]
```

Recommend **Option B** for simplicity - we can always query messages by time range around session completion.

### Handling "No Response"

If the agent chooses not to respond:

- Session still completes successfully
- No `responseMessageId` set (already nullable)
- Log the choice for observability

```typescript
// In agent
if (shouldRespond(context)) {
  await tools.send_message({ content: response })
} else {
  // Agent chose silence - session still completes
  logger.info({ sessionId, reason: "agent_chose_silence" }, "No response sent")
}
```

## Implementation Phases

### Phase 1: Tool Infrastructure

- Create tool definition interface
- Create `message-tool.ts`
- Wire into graph

### Phase 2: Multi-Message Support

- Update session schema if needed (probably not)
- Handle multiple tool calls in single turn
- Rate limiting? (prevent runaway message spam)

### Phase 3: Silence Handling

- Update session completion logic
- Add observability for silence cases
- Consider: should silence trigger a different session status?

## Dependencies

- Requires companion agent refactoring from PR #10 (thin worker, agent module)
- Should be done after 003 (stream context) since tool behavior may depend on context

## Acceptance Criteria

- [ ] `send_message` tool exists and is callable by the agent
- [ ] Agent can send 0, 1, or N messages
- [ ] Session completes correctly regardless of message count
- [ ] Messages are properly attributed to persona
- [ ] Observability for message count and silence cases
- [ ] Rate limiting prevents message spam (e.g., max 5 per invocation)

## References

- PR #10 review discussion
- Future: Similar pattern for `search_knowledge`, `create_memo` tools
