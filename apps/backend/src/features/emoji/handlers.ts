import type { Request, Response } from "express"
import { getEmojiList } from "./emoji"

export function createEmojiHandlers() {
  return {
    async list(_req: Request, res: Response) {
      const emojis = getEmojiList()
      res.json({ emojis })
    },
  }
}
