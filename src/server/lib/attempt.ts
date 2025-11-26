import { logger } from "./logger"

export async function attempt<T>(fn: () => Promise<T> | T): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    logger.error({ err: error }, "Attempt failed")
    return null
  }
}
