import { logger } from "./logger"
import {
  USE_STUB_AUTH,
  WORKOS_API_KEY,
  WORKOS_CLIENT_ID,
  WORKOS_REDIRECT_URI,
  WORKOS_COOKIE_PASSWORD,
} from "../config"

/**
 * Validates that all required environment variables are set
 * Throws an error with helpful message if any are missing
 */
export function validateEnv(): void {
  // Skip WorkOS validation when using stub auth for testing
  if (USE_STUB_AUTH) {
    logger.debug("Skipping WorkOS env validation (USE_STUB_AUTH=true)")
    return
  }

  const required: [string, string | undefined][] = [
    ["WORKOS_API_KEY", WORKOS_API_KEY],
    ["WORKOS_CLIENT_ID", WORKOS_CLIENT_ID],
    ["WORKOS_REDIRECT_URI", WORKOS_REDIRECT_URI],
    ["WORKOS_COOKIE_PASSWORD", WORKOS_COOKIE_PASSWORD],
  ]

  const missing: string[] = []

  for (const [name, value] of required) {
    if (!value) {
      missing.push(name)
    }
  }

  if (missing.length > 0) {
    const errorMessage = `Missing required environment variables: ${missing.join(", ")}`
    logger.error({ missing }, errorMessage)
    throw new Error(errorMessage)
  }

  logger.debug("Environment variables validated")
}
