import { Router, Request, Response, NextFunction } from "express"
import { Pool } from "pg"
import { UserSettingsService, UserSettings } from "../services/user-settings-service"
import { logger } from "../lib/logger"

export function createSettingsRoutes(pool: Pool): Router {
  const router = Router()
  const settingsService = new UserSettingsService(pool)

  /**
   * GET /api/workspaces/:workspaceId/settings
   * Get all user settings for the current workspace.
   */
  router.get("/:workspaceId/settings", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const settings = await settingsService.getSettings(userId, workspaceId)

      res.json({ settings })
    } catch (err) {
      next(err)
    }
  })

  /**
   * PATCH /api/workspaces/:workspaceId/settings
   * Update user settings (partial update).
   */
  router.patch("/:workspaceId/settings", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id
      const updates = req.body as Partial<UserSettings>

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const settings = await settingsService.updateSettings(userId, workspaceId, updates)

      logger.info({ userId, workspaceId }, "User settings updated via API")

      res.json({ settings })
    } catch (err) {
      next(err)
    }
  })

  /**
   * PUT /api/workspaces/:workspaceId/settings/:path
   * Update a specific setting by path (e.g., "sidebarCollapse.channels").
   */
  router.put(
    "/:workspaceId/settings/:path(*)",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, path } = req.params
        const userId = req.user?.id
        const { value } = req.body

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        if (value === undefined) {
          res.status(400).json({ error: "Missing 'value' in request body" })
          return
        }

        const settings = await settingsService.updateSetting(userId, workspaceId, path, value)

        res.json({ settings })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * DELETE /api/workspaces/:workspaceId/settings
   * Reset settings to defaults.
   */
  router.delete("/:workspaceId/settings", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const settings = await settingsService.resetSettings(userId, workspaceId)

      logger.info({ userId, workspaceId }, "User settings reset via API")

      res.json({ settings })
    } catch (err) {
      next(err)
    }
  })

  return router
}
