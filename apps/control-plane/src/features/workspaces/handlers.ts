import type { Request, Response } from "express"
import { z } from "zod/v4"
import { HttpError } from "@threa/backend-common"
import type { ControlPlaneWorkspaceService } from "./service"

interface Dependencies {
  workspaceService: ControlPlaneWorkspaceService
  availableRegions: string[]
}

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  region: z.string().min(1).optional(),
})

export function createWorkspaceHandlers({ workspaceService, availableRegions }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      if (!req.workosUserId) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const workspaces = await workspaceService.listForUser(req.workosUserId)
      res.json({ workspaces })
    },

    async create(req: Request, res: Response) {
      if (!req.workosUserId || !req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const parsed = createWorkspaceSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const workspace = await workspaceService.create({
        name: parsed.data.name,
        region: parsed.data.region,
        workosUserId: req.workosUserId,
        authUser: req.authUser,
      })

      res.status(201).json({ workspace })
    },

    async listRegions(_req: Request, res: Response) {
      res.json({ regions: availableRegions })
    },
  }
}
