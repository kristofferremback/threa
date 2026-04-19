import type { Request, Response } from "express"
import { displayNameFromWorkos } from "@threa/backend-common"
import { HttpError } from "../lib/errors"
import type { PlatformAdminService } from "../features/platform-admins"

interface AuthHandlersDeps {
  platformAdminService: PlatformAdminService
}

export function createAuthHandlers({ platformAdminService }: AuthHandlersDeps) {
  return {
    async me(req: Request, res: Response) {
      const authUser = req.authUser
      if (!authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const name = displayNameFromWorkos(authUser)
      const isPlatformAdmin = await platformAdminService.isPlatformAdmin(authUser.id)
      res.json({
        id: authUser.id,
        email: authUser.email,
        name,
        isPlatformAdmin,
      })
    },
  }
}
