import { logger, type WorkosConfig } from "@threa/backend-common"

export interface RegionConfig {
  internalUrl: string
}

export interface CloudflareKvConfig {
  accountId: string
  namespaceId: string
  apiToken: string
}

export interface ControlPlaneConfig {
  port: number
  databaseUrl: string
  useStubAuth: boolean
  corsAllowedOrigins: string[]
  workos: WorkosConfig
  internalApiKey: string
  regions: Record<string, RegionConfig>
  cloudflareKv?: CloudflareKvConfig
  workspaceCreationRequiresInvite: boolean
  fastShutdown: boolean
  rateLimits: {
    globalMax: number
    authMax: number
  }
}

export function loadControlPlaneConfig(): ControlPlaneConfig {
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

  if (!process.env.INTERNAL_API_KEY && isProduction) {
    throw new Error("INTERNAL_API_KEY is required in production")
  }

  const regionsRaw = process.env.REGIONS
  let regions: Record<string, RegionConfig> = {}
  if (regionsRaw) {
    try {
      regions = JSON.parse(regionsRaw)
    } catch {
      throw new Error("REGIONS must be valid JSON: Record<string, { internalUrl: string }>")
    }
  }

  const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"]

  const config: ControlPlaneConfig = {
    port: Number(process.env.PORT) || 3003,
    databaseUrl: process.env.DATABASE_URL,
    useStubAuth,
    corsAllowedOrigins,
    workos: {
      apiKey: process.env.WORKOS_API_KEY || "",
      clientId: process.env.WORKOS_CLIENT_ID || "",
      redirectUri: process.env.WORKOS_REDIRECT_URI || "",
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    },
    internalApiKey: process.env.INTERNAL_API_KEY || "dev-internal-key",
    regions,
    workspaceCreationRequiresInvite: process.env.WORKSPACE_CREATION_SKIP_INVITE !== "true",
    fastShutdown: process.env.FAST_SHUTDOWN === "true",
    rateLimits: {
      globalMax: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
      authMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
    },
  }

  // Optional Cloudflare KV config
  if (process.env.CLOUDFLARE_KV_ACCOUNT_ID) {
    config.cloudflareKv = {
      accountId: process.env.CLOUDFLARE_KV_ACCOUNT_ID,
      namespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID || "",
      apiToken: process.env.CLOUDFLARE_KV_API_TOKEN || "",
    }
  }

  if (useStubAuth) {
    logger.warn("Control plane: Using stub auth service - NOT FOR PRODUCTION")
  }

  return config
}
