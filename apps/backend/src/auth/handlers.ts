import type { Request, Response } from "express"
import type { Pool } from "pg"
import { displayNameFromWorkos } from "@threa/backend-common"
import { HttpError } from "../lib/errors"
import { PlatformAdminRepository } from "../features/platform-admins"

interface AuthHandlersDeps {
  pool: Pool
}

export function createAuthHandlers({ pool }: AuthHandlersDeps) {
  return {
    async me(req: Request, res: Response) {
      const authUser = req.authUser
      if (!authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const name = displayNameFromWorkos(authUser)
      const isPlatformAdmin = await PlatformAdminRepository.isPlatformAdmin(pool, authUser.id)
      res.json({
        id: authUser.id,
        email: authUser.email,
        name,
        isPlatformAdmin,
      })
    },
  }
}
