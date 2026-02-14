import type { AgentEvent } from "./agent-events"

/**
 * Observes agent runtime events without coupling tracking to execution.
 * Implementations handle DB persistence, OTEL spans, analytics, etc.
 */
export interface AgentObserver {
  handle(event: AgentEvent): Promise<void>
  cleanup?(): Promise<void>

  /**
   * Wrap an async operation with observer-provided context.
   * Used by OTEL to propagate the root span as the active context
   * so that child spans (e.g., from Vercel AI SDK) nest correctly.
   */
  wrapExecution?<T>(fn: () => Promise<T>): Promise<T>
}
