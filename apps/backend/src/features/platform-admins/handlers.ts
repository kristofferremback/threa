import type { Request, Response } from "express"
import { z } from "zod"
import { HttpError } from "../../lib/errors"
import type { PlatformAdminService } from "./service"

const setPlatformAdminSchema = z.object({
  isAdmin: z.boolean(),
})

interface PlatformAdminHandlersDeps {
  platformAdminService: PlatformAdminService
}

export function createPlatformAdminHandlers({ platformAdminService }: PlatformAdminHandlersDeps) {
  return {
    async set(req: Request, res: Response) {
      const workosUserId = req.params.workosUserId
      if (!workosUserId) {
        throw new HttpError("Missing workos user id", { status: 400, code: "MISSING_WORKOS_USER_ID" })
      }

      const parsed = setPlatformAdminSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      await platformAdminService.set(workosUserId, parsed.data.isAdmin)
      res.status(204).end()
    },
  }
}
