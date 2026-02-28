import type { Request, Response } from "express"
import { z } from "zod"
import { HttpError } from "../../lib/errors"
import type { PushService } from "./service"

/**
 * Validate that a push endpoint URL is HTTPS and not targeting a private/loopback address.
 * Web Push endpoints are always HTTPS URLs from browser push services (FCM, Mozilla, etc.).
 */
const pushEndpointSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== "https:") return false
        const host = parsed.hostname
        // Reject loopback, private IP ranges, and link-local addresses
        if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false
        if (host.startsWith("10.")) return false
        if (host.startsWith("192.168.")) return false
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
        if (host.startsWith("169.254.")) return false
        if (host.startsWith("0.")) return false
        return true
      } catch {
        return false
      }
    },
    { message: "Push endpoint must be an HTTPS URL and must not target a private network address" }
  )

const subscribeSchema = z.object({
  endpoint: pushEndpointSchema,
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  deviceKey: z.string().min(1),
  userAgent: z.string().optional(),
})

const unsubscribeSchema = z.object({
  endpoint: pushEndpointSchema,
})

interface Dependencies {
  pushService: PushService
}

export function createPushHandlers({ pushService }: Dependencies) {
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
      res.json({
        vapidPublicKey: pushService.getVapidPublicKey() || null,
        enabled: pushService.isEnabled(),
      })
    },
  }
}
