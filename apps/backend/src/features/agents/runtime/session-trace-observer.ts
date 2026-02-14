import { AgentStepTypes, type TraceSource } from "@threa/types"
import type { SessionTrace } from "../trace-emitter"
import type { AgentEvent } from "./agent-events"
import type { AgentObserver } from "./agent-observer"

/**
 * Maps agent runtime events to SessionTrace calls (DB + socket).
 * This is the user-facing trace that appears in the UI.
 */
export class SessionTraceObserver implements AgentObserver {
  constructor(private readonly trace: SessionTrace) {}

  async handle(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "thinking": {
        const step = await this.trace.startStep({
          stepType: AgentStepTypes.THINKING,
          content: event.content,
        })
        await step.complete({ durationMs: event.durationMs })
        break
      }

      case "tool:complete": {
        const step = await this.trace.startStep({
          stepType: event.trace.stepType,
          content: event.trace.content,
        })
        await step.complete({
          content: event.trace.content,
          sources: event.trace.sources,
          durationMs: event.durationMs,
        })
        break
      }

      case "tool:error": {
        const step = await this.trace.startStep({
          stepType: AgentStepTypes.TOOL_ERROR,
          content: `${event.toolName} failed: ${event.error}`,
        })
        await step.complete({ durationMs: event.durationMs })
        break
      }

      case "message:sent": {
        const step = await this.trace.startStep({
          stepType: AgentStepTypes.MESSAGE_SENT,
          content: event.content,
        })
        await step.complete({
          content: event.content,
          messageId: event.messageId,
          sources: event.sources,
        })
        break
      }

      case "context:received": {
        const step = await this.trace.startStep({
          stepType: AgentStepTypes.CONTEXT_RECEIVED,
          content: JSON.stringify({
            messages: event.messages.map((m) => ({
              messageId: m.messageId,
              authorName: m.authorName,
              authorType: m.authorType,
              createdAt: m.createdAt,
              content: m.content.slice(0, 300),
            })),
          }),
        })
        await step.complete({})
        break
      }

      case "reconsidering": {
        const step = await this.trace.startStep({
          stepType: AgentStepTypes.RECONSIDERING,
          content: JSON.stringify({
            draftResponse: event.draft,
            newMessages: event.newMessages.map((m) => ({
              messageId: m.messageId,
              authorName: m.authorName,
              authorType: m.authorType,
              createdAt: m.createdAt,
              content: m.content.slice(0, 300),
            })),
          }),
        })
        await step.complete({})
        break
      }
    }
  }
}
