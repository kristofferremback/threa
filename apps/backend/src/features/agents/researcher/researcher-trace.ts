import { trace, context, SpanStatusCode } from "@opentelemetry/api"

const tracer = trace.getTracer("workspace-research")

const LANGFUSE_INPUT_ATTR = "langfuse.observation.input"
const LANGFUSE_OUTPUT_ATTR = "langfuse.observation.output"

export interface ResearcherSpanOptions<T> {
  /** JSON-serializable intent payload — sets `langfuse.observation.input`. */
  input?: unknown
  /**
   * Called with the function's result on success to compute the span's
   * `langfuse.observation.output` payload. Skipped on error so failed spans
   * don't carry stale or partial output.
   */
  extractOutput?: (result: T) => unknown
  /** Extra OTEL attributes for the span (e.g. `ws.query.target`). */
  attributes?: Record<string, string | number | boolean>
}

/**
 * Run `fn` inside a child span of the currently-active OTEL context.
 *
 * Used by the workspace researcher to give intent-bearing structure to the
 * tool's internal phases (baseline / plan / refine) and to individual query
 * executions. The active context is normally the `tool:workspace_research`
 * span (set by `OtelObserver.wrapToolExecution`), so spans created here nest
 * under it automatically.
 *
 * Sets `langfuse.observation.input/output` from `opts.input` and
 * `opts.extractOutput(result)` so the Langfuse UI surfaces the actual
 * content of each phase — not just timing.
 */
export async function withResearcherSpan<T>(
  name: string,
  opts: ResearcherSpanOptions<T>,
  fn: () => Promise<T>
): Promise<T> {
  const span = tracer.startSpan(name)
  if (opts.input !== undefined) {
    span.setAttribute(LANGFUSE_INPUT_ATTR, safeJson(opts.input))
  }
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      span.setAttribute(k, v)
    }
  }
  const ctx = trace.setSpan(context.active(), span)
  try {
    const result = await context.with(ctx, fn)
    if (opts.extractOutput) {
      span.setAttribute(LANGFUSE_OUTPUT_ATTR, safeJson(opts.extractOutput(result)))
    }
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    span.setStatus({ code: SpanStatusCode.ERROR, message })
    throw err
  } finally {
    span.end()
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
