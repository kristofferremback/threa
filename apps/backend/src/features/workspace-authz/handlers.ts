import type { NextFunction, Request, Response } from "express"
import { z } from "zod"
import { HttpError } from "../../lib/errors"
import type { WorkspaceAuthzService } from "./service"

const upsertSchema = z.object({
  kind: z.literal("upsert"),
  workspaceId: z.string().min(1),
  workosUserId: z.string().min(1),
  roleSlugs: z.array(z.string()),
  status: z.string().min(1),
  lastEventAt: z.string().datetime(),
})

const removeSchema = z.object({
  kind: z.literal("remove"),
  workspaceId: z.string().min(1),
  workosUserId: z.string().min(1),
  eventCreatedAt: z.string().datetime(),
})

const bodySchema = z.discriminatedUnion("kind", [upsertSchema, removeSchema])

interface Dependencies {
  workspaceAuthzService: WorkspaceAuthzService
}

export function createWorkspaceAuthzHandlers({ workspaceAuthzService }: Dependencies) {
  return {
    /**
     * POST /internal/authz/memberships
     * CP fan-out endpoint for membership changes within this region.
     */
    async syncMembership(req: Request, res: Response, next: NextFunction) {
      const result = bodySchema.safeParse(req.body)
      if (!result.success) {
        next(new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" }))
        return
      }

      if (result.data.kind === "upsert") {
        await workspaceAuthzService.applyMembershipChange({
          workspaceId: result.data.workspaceId,
          workosUserId: result.data.workosUserId,
          roleSlugs: result.data.roleSlugs,
          status: result.data.status,
          lastEventAt: new Date(result.data.lastEventAt),
        })
      } else {
        await workspaceAuthzService.applyMembershipRemoval({
          workspaceId: result.data.workspaceId,
          workosUserId: result.data.workosUserId,
          eventCreatedAt: new Date(result.data.eventCreatedAt),
        })
      }

      res.status(204).end()
    },
  }
}
