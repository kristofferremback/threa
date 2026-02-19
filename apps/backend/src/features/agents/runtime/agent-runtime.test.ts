import { describe, expect, it } from "bun:test"
import { AgentToolNames } from "@threa/types"
import type { AgentEvent } from "./agent-events"
import { AgentRuntime } from "./agent-runtime"

describe("AgentRuntime message counting", () => {
  it("counts edited responses as sent output", async () => {
    const events: AgentEvent[] = []

    const runtime = new AgentRuntime({
      ai: {
        generateTextWithTools: async () => ({
          text: "",
          toolCalls: [
            {
              toolCallId: "tool_1",
              toolName: AgentToolNames.SEND_MESSAGE,
              input: { content: "Updated response" },
            },
          ],
          response: {
            messages: [{ role: "assistant", content: "Updating response now." } as any],
          },
        }),
      } as any,
      model: {} as any,
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Please update your previous answer." }],
      tools: [],
      sendMessage: async () => ({ messageId: "msg_1", operation: "edited" }),
      observers: [
        {
          handle: async (event: AgentEvent) => {
            events.push(event)
          },
        },
      ],
    })

    const result = await runtime.run()

    expect(result.messagesSent).toBe(1)
    expect(result.sentMessageIds).toEqual(["msg_1"])
    expect(events.some((event) => event.type === "message:edited")).toBe(true)
    expect(events.some((event) => event.type === "session:end" && event.messagesSent === 1)).toBe(true)
  })
})
