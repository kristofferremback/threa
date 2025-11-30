import { logger } from "./logger"

interface EnvConfig {
  WORKOS_API_KEY: string
  WORKOS_CLIENT_ID: string
  WORKOS_REDIRECT_URI: string
  WORKOS_COOKIE_PASSWORD: string
}

/**
 * Validates that all required environment variables are set
 * Throws an error with helpful message if any are missing
 */
export function validateEnv(): void {
  // Skip WorkOS validation when using stub auth for testing
  if (process.env.USE_STUB_AUTH === "true") {
    logger.debug("Skipping WorkOS env validation (USE_STUB_AUTH=true)")
    return
  }

  const required: (keyof EnvConfig)[] = [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_REDIRECT_URI",
    "WORKOS_COOKIE_PASSWORD",
  ]

  const missing: string[] = []

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    const errorMessage = `Missing required environment variables: ${missing.join(", ")}`
    logger.error({ missing }, errorMessage)
    throw new Error(errorMessage)
  }

  logger.debug("Environment variables validated")
}
