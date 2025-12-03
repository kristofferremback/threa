import type { Request, Response, NextFunction, RequestHandler } from "express"
import { Pool } from "pg"
import { UserSettingsService, UserSettings } from "../services/user-settings-service"
import { logger } from "../lib/logger"

export interface SettingsDeps {
  pool: Pool
}

export function createSettingsHandlers({ pool }: SettingsDeps) {
  const settingsService = new UserSettingsService(pool)

  const getSettings: RequestHandler = async (req, res, next) => {
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
  }

  const updateSettings: RequestHandler = async (req, res, next) => {
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
  }

  const updateSettingByPath: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const path = req.params[0] // Express captures wildcard as params[0]
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
  }

  const resetSettings: RequestHandler = async (req, res, next) => {
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
  }

  return { getSettings, updateSettings, updateSettingByPath, resetSettings }
}
