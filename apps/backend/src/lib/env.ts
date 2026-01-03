import { logger } from "./logger"

export interface WorkosConfig {
  apiKey: string
  clientId: string
  redirectUri: string
  cookiePassword: string
}

export interface AIConfig {
  openRouterApiKey: string
  /** Tavily API key for web search */
  tavilyApiKey: string
  /** Model for stream auto-naming, in provider:model format (e.g., "openrouter:anthropic/claude-haiku-4.5") */
  namingModel: string
  /** Model for conversational boundary extraction, in provider:model format */
  extractionModel: string
  /** Model for memo classification and generation, in provider:model format */
  memoModel: string
}

export interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Optional endpoint for S3-compatible services (MinIO, R2, etc.) */
  endpoint?: string
}

export interface Config {
  port: number
  databaseUrl: string
  useStubAuth: boolean
  useStubCompanion: boolean
  useStubBoundaryExtraction: boolean
  workos: WorkosConfig
  ai: AIConfig
  s3: S3Config
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
  const useStubBoundaryExtraction = process.env.USE_STUB_BOUNDARY_EXTRACTION === "true"

  const config: Config = {
    port: Number(process.env.PORT) || 3001,
    databaseUrl: process.env.DATABASE_URL,
    useStubAuth,
    useStubCompanion,
    useStubBoundaryExtraction,
    workos: {
      apiKey: process.env.WORKOS_API_KEY || "",
      clientId: process.env.WORKOS_CLIENT_ID || "",
      redirectUri: process.env.WORKOS_REDIRECT_URI || "",
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    },
    ai: {
      openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
      tavilyApiKey: process.env.TAVILY_API_KEY || "",
      namingModel: process.env.AI_NAMING_MODEL || "openrouter:openai/gpt-4o-mini",
      extractionModel: process.env.AI_EXTRACTION_MODEL || "openrouter:openai/gpt-4o-mini",
      memoModel: process.env.AI_MEMO_MODEL || "openrouter:openai/gpt-4o-mini",
    },
    s3: {
      bucket: process.env.S3_BUCKET || "threa-uploads",
      region: process.env.S3_REGION || "us-east-1",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      endpoint: process.env.S3_ENDPOINT,
    },
  }

  if (useStubAuth) {
    logger.warn("Using stub auth service - NOT FOR PRODUCTION")
  }

  if (useStubCompanion) {
    logger.warn("Using stub companion service - NOT FOR PRODUCTION")
  }

  if (useStubBoundaryExtraction) {
    logger.warn("Using stub boundary extraction - NOT FOR PRODUCTION")
  }

  return config
}
