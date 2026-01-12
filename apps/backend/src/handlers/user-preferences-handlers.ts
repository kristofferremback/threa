import { z } from "zod"
import type { Request, Response } from "express"
import type { UserPreferencesService } from "../services/user-preferences-service"
import {
  THEME_OPTIONS,
  MESSAGE_DISPLAY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  NOTIFICATION_LEVEL_OPTIONS,
  FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  MESSAGE_SEND_MODE_OPTIONS,
} from "@threa/types"

const updatePreferencesSchema = z.object({
  theme: z.enum(THEME_OPTIONS).optional(),
  messageDisplay: z.enum(MESSAGE_DISPLAY_OPTIONS).optional(),
  dateFormat: z.enum(DATE_FORMAT_OPTIONS).optional(),
  timeFormat: z.enum(TIME_FORMAT_OPTIONS).optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  notificationLevel: z.enum(NOTIFICATION_LEVEL_OPTIONS).optional(),
  sidebarCollapsed: z.boolean().optional(),
  messageSendMode: z.enum(MESSAGE_SEND_MODE_OPTIONS).optional(),
  keyboardShortcuts: z.record(z.string(), z.string()).optional(),
  accessibility: z
    .object({
      reducedMotion: z.boolean().optional(),
      highContrast: z.boolean().optional(),
      fontSize: z.enum(FONT_SIZE_OPTIONS).optional(),
      fontFamily: z.enum(FONT_FAMILY_OPTIONS).optional(),
    })
    .optional(),
})

export { updatePreferencesSchema }

interface Dependencies {
  userPreferencesService: UserPreferencesService
}

export function createUserPreferencesHandlers({ userPreferencesService }: Dependencies) {
  return {
    async get(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const preferences = await userPreferencesService.getPreferences(workspaceId, userId)
      res.json({ preferences })
    },

    async update(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const result = updatePreferencesSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const preferences = await userPreferencesService.updatePreferences(workspaceId, userId, result.data)
      res.json({ preferences })
    },
  }
}
