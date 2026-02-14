import { trace, context, SpanStatusCode, type Span, type Context } from "@opentelemetry/api"
import type { AgentEvent } from "./agent-events"
import type { AgentObserver } from "./agent-observer"

const tracer = trace.getTracer("agent-runtime")

interface OtelObserverConfig {
  sessionId: string
  streamId: string
  personaId: string
  metadata?: Record<string, string | number | boolean>
}

/**
 * Maps agent runtime events to OpenTelemetry spans with Langfuse attributes.
 * Manages root span lifecycle and per-tool child spans.
 *
 * Provides `wrapExecution` so the runtime can run AI SDK calls within
 * the root span's context — making SDK-created spans nest correctly.
 */
export class OtelObserver implements AgentObserver {
  private rootSpan: Span | null = null
  private rootContext: Context | null = null
  private toolSpans = new Map<string, Span>()

  constructor(private readonly config: OtelObserverConfig) {}

  async handle(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "session:start": {
        this.rootSpan = tracer.startSpan("companion-session", {
          attributes: {
            "langfuse.session.id": this.config.sessionId,
            "session.id": this.config.sessionId,
            "stream.id": this.config.streamId,
            "persona.id": this.config.personaId,
            ...(this.config.metadata ?? {}),
          },
        })
        this.rootContext = trace.setSpan(context.active(), this.rootSpan)
        if (event.inputSummary) {
          this.rootSpan.setAttribute("langfuse.observation.input", event.inputSummary)
        }
        break
      }

      case "tool:start": {
        const toolSpan = tracer.startSpan(`tool:${event.toolName}`, {}, this.rootContext ?? undefined)
        toolSpan.setAttribute("input.value", JSON.stringify(event.input))
        this.toolSpans.set(event.toolCallId, toolSpan)
        break
      }

      case "tool:complete": {
        const toolSpan = this.toolSpans.get(event.toolCallId)
        if (toolSpan) {
          toolSpan.setAttribute("output.value", event.output)
          toolSpan.setStatus({ code: SpanStatusCode.OK })
          toolSpan.end()
          this.toolSpans.delete(event.toolCallId)
        }
        break
      }

      case "tool:error": {
        const toolSpan = this.toolSpans.get(event.toolCallId)
        if (toolSpan) {
          toolSpan.setAttribute("output.value", JSON.stringify({ error: event.error }))
          toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: event.error })
          toolSpan.end()
          this.toolSpans.delete(event.toolCallId)
        }
        break
      }

      case "session:end": {
        if (this.rootSpan) {
          this.rootSpan.setAttributes({
            "session.messages_sent": event.messagesSent,
            "session.source_count": event.sourceCount,
            "langfuse.observation.output": event.lastContent ?? "",
          })
          this.rootSpan.setStatus({ code: SpanStatusCode.OK })
          this.rootSpan.end()
          this.rootSpan = null
          this.rootContext = null
        }
        break
      }

      case "session:error": {
        if (this.rootSpan) {
          this.rootSpan.setAttributes({
            "langfuse.observation.output": JSON.stringify({ error: event.error }),
          })
          this.rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: event.error })
          this.rootSpan.end()
          this.rootSpan = null
          this.rootContext = null
        }
        break
      }
    }
  }

  async wrapExecution<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.rootContext) return fn()
    return context.with(this.rootContext, fn)
  }

  async cleanup(): Promise<void> {
    // End any orphaned tool spans
    for (const [, span] of this.toolSpans) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Orphaned tool span" })
      span.end()
    }
    this.toolSpans.clear()

    if (this.rootSpan) {
      this.rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: "Orphaned root span" })
      this.rootSpan.end()
      this.rootSpan = null
      this.rootContext = null
    }
  }
}
