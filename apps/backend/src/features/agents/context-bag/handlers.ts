import type { Request, Response } from "express"
import type { Pool } from "pg"
import { z } from "zod"
import type { AI } from "../../../lib/ai/ai"
import { ContextIntents, ContextRefKinds, type ContextIntent } from "@threa/types"
import { withClient } from "../../../db"
import {
  fetchStreamBag,
  type ContextRefSource,
  type EnrichedContextRef,
  type StreamContextBagResponse,
} from "./fetch-stream-bag"
import * as precomputeService from "./precompute-service"

interface Dependencies {
  pool: Pool
  ai: AI
}

const threadRefSchema = z.object({
  kind: z.literal(ContextRefKinds.THREAD),
  streamId: z.string().min(1),
  fromMessageId: z.string().min(1).optional(),
  toMessageId: z.string().min(1).optional(),
})

const refSchema = z.discriminatedUnion("kind", [threadRefSchema])

const precomputeSchema = z.object({
  intent: z.enum([ContextIntents.DISCUSS_THREAD]),
  refs: z.array(refSchema).min(1).max(10),
})

// Re-export so existing import sites keep working without churn.
export type { ContextRefSource, EnrichedContextRef, StreamContextBagResponse }

export function createContextBagHandlers({ pool, ai }: Dependencies) {
  return {
    /**
     * POST /api/workspaces/:workspaceId/context-bag/precompute
     *
     * Pre-warms `context_summaries` for a set of refs before the caller
     * commits them to a stream. The client typically calls this the moment
     * the user attaches a context ref to the composer draft, so by the time
     * they click send the summary cache is already warm and the first turn
     * runs without an inline summarization wait.
     *
     * Does NOT create a `stream_context_attachments` row — that gets written
     * when the user sends their first message via `POST /streams`.
     */
    async precompute(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = precomputeSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(parsed.error).fieldErrors,
        })
      }

      const { intent, refs } = parsed.data
      const results = await precomputeService.precomputeRefSummaries(
        { pool, ai },
        { workspaceId, userId, intent: intent as ContextIntent, refs }
      )

      res.json({ refs: results })
    },

    /**
     * GET /api/workspaces/:workspaceId/streams/:streamId/context-bag
     *
     * Returns the bag attached to a stream (if any), plus enriched per-ref
     * source-stream metadata so the composer's `<ContextRefStrip>` can
     * render rich labels ("12 messages in #intro") without re-fetching
     * source threads. Access-gated on stream membership; per-ref read
     * access is re-verified via the resolver's assertAccess (INV-8).
     *
     * Response shape stays stable when no bag is attached: `bag: null`,
     * `refs: []`. Lets the strip render an empty state without an extra
     * "is this stream bag-attached?" probe.
     */
    async getStreamBag(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = await withClient(pool, async (db) => fetchStreamBag(db, { workspaceId, streamId, userId }))

      res.json(result)
    },
  }
}
