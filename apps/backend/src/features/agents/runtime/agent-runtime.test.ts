import { describe, expect, it, mock } from "bun:test"
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

  it("stops early when rerun drafts repeatedly fail validation", async () => {
    const events: AgentEvent[] = []
    const generateTextWithTools = mock(async () => ({
      text: "I've already sent three replies.",
      toolCalls: [],
      response: {
        messages: [{ role: "assistant", content: "I've already sent three replies." } as any],
      },
    }))

    const runtime = new AgentRuntime({
      ai: { generateTextWithTools } as any,
      model: {} as any,
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Reply three times with numbers." }],
      tools: [],
      allowNoMessageOutput: true,
      validateFinalResponse: async () => "Send the requested reply content, not an action summary.",
      sendMessage: async () => ({ messageId: "msg_unused", operation: "created" }),
      observers: [
        {
          handle: async (event: AgentEvent) => {
            events.push(event)
          },
        },
      ],
    })

    const result = await runtime.run()

    expect(generateTextWithTools).toHaveBeenCalledTimes(3)
    expect(result.messagesSent).toBe(0)
    expect(result.noMessageReason).toBe(
      "Kept the previous response because revised drafts repeatedly failed validation after context updates."
    )
    expect(events.some((event) => event.type === "response:kept")).toBe(true)
  })

  it("stops early when rerun keeps returning empty final decisions", async () => {
    const generateTextWithTools = mock(async () => ({
      text: " ",
      toolCalls: [],
      response: {
        messages: [{ role: "assistant", content: " " } as any],
      },
    }))

    const runtime = new AgentRuntime({
      ai: { generateTextWithTools } as any,
      model: {} as any,
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Reply three times with numbers." }],
      tools: [],
      allowNoMessageOutput: true,
      sendMessage: async () => ({ messageId: "msg_unused", operation: "created" }),
    })

    const result = await runtime.run()

    expect(generateTextWithTools).toHaveBeenCalledTimes(3)
    expect(result.messagesSent).toBe(0)
    expect(result.noMessageReason).toBe(
      "Kept the previous response because the rerun produced no actionable output after repeated attempts."
    )
  })
})
