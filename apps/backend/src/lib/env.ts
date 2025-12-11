import { logger } from "./logger"

export interface WorkosConfig {
  apiKey: string
  clientId: string
  redirectUri: string
  cookiePassword: string
}

export interface OpenRouterConfig {
  apiKey: string
  defaultModel: string
}

export interface Config {
  port: number
  databaseUrl: string
  useStubAuth: boolean
  workos: WorkosConfig
  openrouter: OpenRouterConfig
}

export function loadConfig(): Config {
  const useStubAuth = process.env.USE_STUB_AUTH === "true"

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required")
  }

  if (!useStubAuth) {
    const required = [
      "WORKOS_API_KEY",
      "WORKOS_CLIENT_ID",
      "WORKOS_REDIRECT_URI",
      "WORKOS_COOKIE_PASSWORD",
    ]
    const missing = required.filter((key) => !process.env[key])
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
    }
  }

  const config: Config = {
    port: Number(process.env.PORT) || 3001,
    databaseUrl: process.env.DATABASE_URL,
    useStubAuth,
    workos: {
      apiKey: process.env.WORKOS_API_KEY || "",
      clientId: process.env.WORKOS_CLIENT_ID || "",
      redirectUri: process.env.WORKOS_REDIRECT_URI || "",
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || "",
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || "anthropic/claude-3-haiku",
    },
  }

  if (useStubAuth) {
    logger.warn("Using stub auth service - NOT FOR PRODUCTION")
  }

  return config
}
