import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import { ASSET_KINDS, EXTRACTION_CONTENT_TYPES, type AssetSearchResponse } from "@threa/types"
import type { AssetExplorerService } from "./service"
import { resolveAssetSearchScope } from "./scope"

const scopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stream"),
    streamId: z.string().min(1),
  }),
])

const filtersSchema = z
  .object({
    from: z.string().min(1).optional(),
    mimeGroups: z.array(z.enum(ASSET_KINDS)).optional(),
    contentTypes: z.array(z.enum(EXTRACTION_CONTENT_TYPES)).optional(),
    before: z.string().datetime().optional(),
    after: z.string().datetime().optional(),
  })
  .optional()

const requestSchema = z.object({
  query: z.string().optional().default(""),
  exact: z.boolean().optional().default(false),
  scope: scopeSchema,
  filters: filtersSchema,
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

interface Dependencies {
  pool: Pool
  assetExplorerService: AssetExplorerService
}

export function createAssetExplorerHandlers({ pool, assetExplorerService }: Dependencies) {
  return {
    /**
     * POST /api/workspaces/:workspaceId/assets/search
     *
     * Browse + search attachments accessible to the requester.
     * Stream-scoped today; the `scope` discriminator is forward-compatible
     * with workspace-wide scope (no wire change required).
     */
    async search(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = requestSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(parsed.error).fieldErrors,
        })
      }

      const { query, exact, scope, filters, cursor, limit } = parsed.data

      const accessibleStreamIds = await resolveAssetSearchScope(pool, workspaceId, userId, scope)
      if (accessibleStreamIds === null) {
        return res.status(404).json({ error: "Stream not found" })
      }

      const result = await assetExplorerService.search({
        workspaceId,
        permissions: { accessibleStreamIds },
        scope,
        query,
        exact,
        filters: {
          uploadedBy: filters?.from,
          mimeKinds: filters?.mimeGroups,
          contentTypes: filters?.contentTypes,
          before: filters?.before ? new Date(filters.before) : undefined,
          after: filters?.after ? new Date(filters.after) : undefined,
        },
        cursor: cursor ?? null,
        limit: limit ?? 30,
      })

      const response: AssetSearchResponse = {
        results: result.results,
        nextCursor: result.nextCursor,
      }
      res.json(response)
    },
  }
}
