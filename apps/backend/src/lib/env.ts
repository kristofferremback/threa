import { logger } from "./logger"
import type { WorkosConfig } from "@threa/backend-common"

export type { WorkosConfig } from "@threa/backend-common"

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

export interface AttachmentSafetyConfig {
  /** Whether malware scanning is enabled for uploaded files. */
  malwareScanEnabled: boolean
}

export interface PushConfig {
  vapidPublicKey: string
  vapidPrivateKey: string
  /** mailto: URI for VAPID identification */
  vapidSubject: string
  enabled: boolean
}

export interface Config {
  port: number
  databaseUrl: string
  /** Skip graceful shutdown for immediate termination (dev/test environments) */
  fastShutdown: boolean
  workspaceCreationRequiresInvite: boolean
  useStubAuth: boolean
  useStubCompanion: boolean
  useStubBoundaryExtraction: boolean
  /** Stub all AI features (naming, embedding, memo processing) */
  useStubAI: boolean
  /** Allowed CORS origins. In production, must be explicitly configured. */
  corsAllowedOrigins: string[]
  rateLimits: {
    globalMax: number
    authMax: number
  }
  workos: WorkosConfig
  ai: AIConfig
  s3: S3Config
  attachments: AttachmentSafetyConfig
  push: PushConfig
  /** Control-plane URL for inter-service communication (optional — only needed in multi-region) */
  controlPlaneUrl: string | null
  /** Shared secret for authenticating internal API calls from the control-plane */
  internalApiKey: string | null
  /** This instance's region name (e.g., "eu-north-1") */
  region: string | null
}

export function loadConfig(): Config {
  const isProduction = process.env.NODE_ENV === "production"
  const useStubAuth = process.env.USE_STUB_AUTH === "true"

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required")
  }

  if (isProduction && useStubAuth) {
    throw new Error("USE_STUB_AUTH must be false in production")
  }

  if (isProduction && !process.env.CORS_ALLOWED_ORIGINS) {
    throw new Error("CORS_ALLOWED_ORIGINS is required in production")
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
  const useStubAI = process.env.USE_STUB_AI === "true"
  const fastShutdown = process.env.FAST_SHUTDOWN === "true"

  const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"]

  const config: Config = {
    port: Number(process.env.PORT) || 3001,
    databaseUrl: process.env.DATABASE_URL,
    fastShutdown,
    workspaceCreationRequiresInvite: process.env.WORKSPACE_CREATION_SKIP_INVITE !== "true",
    useStubAuth,
    useStubCompanion,
    useStubBoundaryExtraction,
    useStubAI,
    corsAllowedOrigins,
    rateLimits: {
      globalMax: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
      authMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
    },
    workos: {
      apiKey: process.env.WORKOS_API_KEY || "",
      clientId: process.env.WORKOS_CLIENT_ID || "",
      redirectUri: process.env.WORKOS_REDIRECT_URI || "",
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    },
    ai: {
      openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
      tavilyApiKey: process.env.TAVILY_API_KEY || "",
      namingModel: process.env.AI_NAMING_MODEL || "openrouter:openai/gpt-5-mini",
      extractionModel: process.env.AI_EXTRACTION_MODEL || "openrouter:openai/gpt-5-mini",
      memoModel: process.env.AI_MEMO_MODEL || "openrouter:openai/gpt-oss-120b",
    },
    s3: {
      bucket: process.env.S3_BUCKET || "threa-uploads",
      region: process.env.S3_REGION || "us-east-1",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      endpoint: process.env.S3_ENDPOINT,
    },
    attachments: {
      malwareScanEnabled: process.env.ATTACHMENT_MALWARE_SCAN_ENABLED !== "false",
    },
    push: {
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
      vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
      vapidSubject: process.env.VAPID_SUBJECT || "mailto:push@threa.app",
      enabled: !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
    },
    controlPlaneUrl: process.env.CONTROL_PLANE_URL || null,
    internalApiKey: process.env.INTERNAL_API_KEY || null,
    region: process.env.REGION || null,
  }

  // Validate co-presence: VAPID keys must both be set or both be absent (INV-11)
  const hasPublicKey = !!process.env.VAPID_PUBLIC_KEY
  const hasPrivateKey = !!process.env.VAPID_PRIVATE_KEY
  if (hasPublicKey !== hasPrivateKey) {
    throw new Error(
      "Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together — push notifications require both keys"
    )
  }

  // Validate co-presence: REGION and INTERNAL_API_KEY are required when CONTROL_PLANE_URL is set (INV-11)
  if (config.controlPlaneUrl && !config.region) {
    throw new Error(
      "REGION is required when CONTROL_PLANE_URL is set — shadow sync needs to know this instance's region"
    )
  }
  if (config.controlPlaneUrl && !config.internalApiKey) {
    throw new Error(
      "INTERNAL_API_KEY is required when CONTROL_PLANE_URL is set — inter-service calls need authentication"
    )
  }

  if (useStubAuth) {
    logger.warn("Using stub auth service - NOT FOR PRODUCTION")
    if (config.workspaceCreationRequiresInvite) {
      logger.warn(
        "USE_STUB_AUTH is enabled while workspace creation invite checks are enabled; stub auth cannot verify WorkOS invites and will allow workspace creation. Set WORKSPACE_CREATION_SKIP_INVITE=true to make the bypass explicit."
      )
    }
  }

  if (useStubCompanion) {
    logger.warn("Using stub companion service - NOT FOR PRODUCTION")
  }

  if (useStubBoundaryExtraction) {
    logger.warn("Using stub boundary extraction - NOT FOR PRODUCTION")
  }

  if (useStubAI) {
    logger.warn("Using stub AI services (naming, embedding, memo) - NOT FOR PRODUCTION")
  }

  return config
}
