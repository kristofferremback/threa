import type { Request, Response } from "express"
import type { Pool } from "pg"
import { z } from "zod"
import type { AI } from "../../../lib/ai/ai"
import { ContextIntents, ContextRefKinds, type ContextIntent } from "@threa/types"
import { withClient } from "../../../db"
import { HttpError } from "../../../lib/errors"
import { StreamRepository, StreamMemberRepository } from "../../streams"
import { MessageRepository } from "../../messaging"
import { ContextBagRepository } from "./repository"
import { getResolver } from "./registry"
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

/**
 * Per-ref source-stream metadata returned by `GET /streams/:id/context-bag`.
 * Drives the label the composer strip renders ("12 messages in #intro").
 * Item-count comes from the source stream so the strip stays correct
 * without forcing the client to re-fetch the source thread.
 */
export interface ContextRefSource {
  streamId: string
  displayName: string | null
  slug: string | null
  type: string
  itemCount: number
}

export interface EnrichedContextRef {
  kind: typeof ContextRefKinds.THREAD
  streamId: string
  fromMessageId: string | null
  toMessageId: string | null
  source: ContextRefSource
}

export interface StreamContextBagResponse {
  bag: {
    id: string
    intent: ContextIntent
  } | null
  refs: EnrichedContextRef[]
}

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

      const result = await withClient(pool, async (db) => {
        const stream = await StreamRepository.findById(db, streamId)
        if (!stream || stream.workspaceId !== workspaceId) {
          throw new HttpError("Stream not found", { status: 404, code: "STREAM_NOT_FOUND" })
        }

        const isMember = await StreamMemberRepository.isMember(db, streamId, userId)
        if (!isMember) {
          throw new HttpError("No access to stream", { status: 403, code: "STREAM_FORBIDDEN" })
        }

        const bag = await ContextBagRepository.findByStream(db, streamId)
        if (!bag) {
          return { bag: null, refs: [] satisfies EnrichedContextRef[] }
        }

        const enriched: EnrichedContextRef[] = []
        for (const ref of bag.refs) {
          const resolver = getResolver(ref.kind)
          // Re-verify per-ref access — the user might have lost membership on
          // the source stream between bag creation and this read.
          await resolver.assertAccess(db, ref, userId, workspaceId)

          const sourceStream = await StreamRepository.findById(db, ref.streamId)
          if (!sourceStream) continue

          // Lightweight count for the chip label. One indexed query per ref,
          // capped by `bag.refs.length` (≤ 10) per the precompute schema.
          const itemCount = await MessageRepository.countByStream(db, ref.streamId)

          enriched.push({
            kind: ContextRefKinds.THREAD,
            streamId: ref.streamId,
            fromMessageId: ref.fromMessageId ?? null,
            toMessageId: ref.toMessageId ?? null,
            source: {
              streamId: sourceStream.id,
              displayName: sourceStream.displayName ?? null,
              slug: sourceStream.slug ?? null,
              type: sourceStream.type,
              itemCount,
            },
          })
        }

        return {
          bag: { id: bag.id, intent: bag.intent },
          refs: enriched,
        } satisfies StreamContextBagResponse
      })

      res.json(result)
    },
  }
}
