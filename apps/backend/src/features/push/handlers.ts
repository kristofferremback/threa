import type { Request, Response } from "express"
import { z } from "zod"
import { HttpError } from "../../lib/errors"
import type { PushService } from "./service"

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  deviceKey: z.string().min(1),
  userAgent: z.string().optional(),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

interface Dependencies {
  pushService: PushService
  vapidPublicKey: string
}

export function createPushHandlers({ pushService, vapidPublicKey }: Dependencies) {
  return {
    async subscribe(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = subscribeSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid subscription data", { status: 400, code: "VALIDATION_ERROR" })
      }

      const subscription = await pushService.subscribe({
        workspaceId,
        userId,
        ...parsed.data,
      })

      res.json({ subscription: { id: subscription.id } })
    },

    async unsubscribe(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = unsubscribeSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid unsubscribe data", { status: 400, code: "VALIDATION_ERROR" })
      }

      await pushService.unsubscribe(workspaceId, userId, parsed.data.endpoint)
      res.json({ ok: true })
    },

    async getVapidKey(_req: Request, res: Response) {
      res.json({ vapidPublicKey })
    },
  }
}
