import { logger } from "./logger"

export interface WorkosConfig {
  apiKey: string
  clientId: string
  redirectUri: string
  cookiePassword: string
}

export interface AIConfig {
  openRouterApiKey: string
  /** Model for stream auto-naming, in provider:model format (e.g., "openrouter:anthropic/claude-3-haiku") */
  namingModel: string
}

export interface Config {
  port: number
  databaseUrl: string
  useStubAuth: boolean
  useStubCompanion: boolean
  workos: WorkosConfig
  ai: AIConfig
}

export function loadConfig(): Config {
  const useStubAuth = process.env.USE_STUB_AUTH === "true"

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required")
  }

  if (!useStubAuth) {
    const required = ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_REDIRECT_URI", "WORKOS_COOKIE_PASSWORD"]
    const missing = required.filter((key) => !process.env[key])
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
    }
  }

  const useStubCompanion = process.env.USE_STUB_COMPANION === "true"

  const config: Config = {
    port: Number(process.env.PORT) || 3001,
    databaseUrl: process.env.DATABASE_URL,
    useStubAuth,
    useStubCompanion,
    workos: {
      apiKey: process.env.WORKOS_API_KEY || "",
      clientId: process.env.WORKOS_CLIENT_ID || "",
      redirectUri: process.env.WORKOS_REDIRECT_URI || "",
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    },
    ai: {
      openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
      namingModel: process.env.AI_NAMING_MODEL || "openrouter:anthropic/claude-3-haiku",
    },
  }

  if (useStubAuth) {
    logger.warn("Using stub auth service - NOT FOR PRODUCTION")
  }

  if (useStubCompanion) {
    logger.warn("Using stub companion service - NOT FOR PRODUCTION")
  }

  return config
}
