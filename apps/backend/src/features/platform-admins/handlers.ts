import type { Request, Response } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { HttpError } from "../../lib/errors"
import { PlatformAdminRepository } from "./repository"

const setPlatformAdminSchema = z.object({
  isAdmin: z.boolean(),
})

interface PlatformAdminHandlersDeps {
  pool: Pool
}

export function createPlatformAdminHandlers({ pool }: PlatformAdminHandlersDeps) {
  return {
    /**
     * PUT /internal/platform-admins/:workosUserId
     * Called by the control-plane to grant or revoke platform-admin access
     * for a WorkOS user in this region.
     */
    async set(req: Request, res: Response) {
      const workosUserId = req.params.workosUserId
      if (!workosUserId) {
        throw new HttpError("Missing workos user id", { status: 400, code: "MISSING_WORKOS_USER_ID" })
      }

      const parsed = setPlatformAdminSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      if (parsed.data.isAdmin) {
        await PlatformAdminRepository.grant(pool, workosUserId)
      } else {
        await PlatformAdminRepository.revoke(pool, workosUserId)
      }

      res.status(204).end()
    },
  }
}
