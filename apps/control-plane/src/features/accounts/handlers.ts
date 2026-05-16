import type { Request, Response } from "express"
import { z } from "zod/v4"
import { HttpError, SESSION_COOKIE_NAME } from "@threa/backend-common"
import type { AccountsService } from "./service"

interface Dependencies {
  accountsService: AccountsService
}

const targetSchema = z.object({
  targetUserId: z.string().min(1),
})

export function createAccountsHandlers({ accountsService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      if (!req.workosUserId || !req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      res.json(await accountsService.list(req.cookies, req.authUser))
    },

    async switch(req: Request, res: Response) {
      if (!req.workosUserId || !req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const parsed = targetSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }
      const activeSealed = req.cookies[SESSION_COOKIE_NAME]
      res.json(await accountsService.switch(res, req.cookies, activeSealed, req.authUser, parsed.data.targetUserId))
    },

    async remove(req: Request, res: Response) {
      if (!req.workosUserId || !req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const parsed = targetSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }
      const activeSealed = req.cookies[SESSION_COOKIE_NAME]
      res.json(await accountsService.remove(res, req.cookies, activeSealed, req.authUser, parsed.data.targetUserId))
    },
  }
}
