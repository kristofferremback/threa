import type { AgentEvent } from "./agent-events"

/**
 * Observes agent runtime events without coupling tracking to execution.
 * Implementations handle DB persistence, OTEL spans, analytics, etc.
 */
export interface AgentObserver {
  handle(event: AgentEvent): Promise<void>
  cleanup?(): Promise<void>
}
