import { NodeSDK } from "@opentelemetry/sdk-node"
import { LangfuseSpanProcessor } from "@langfuse/otel"
import { logger } from "./logger"

let otelSdk: NodeSDK | null = null

export interface LangfuseConfig {
  secretKey: string
  publicKey: string
  baseUrl: string
}

/**
 * Check if Langfuse is configured and available.
 */
export function isLangfuseEnabled(): boolean {
  return !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY)
}

/**
 * Initialize Langfuse OpenTelemetry tracing.
 * Must be called early in application startup, before any LangChain usage.
 */
export function initLangfuse(): void {
  if (!isLangfuseEnabled()) {
    logger.info("Langfuse not configured, skipping initialization")
    return
  }

  if (otelSdk) {
    logger.warn("Langfuse already initialized")
    return
  }

  const config: LangfuseConfig = {
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL || "http://localhost:3100",
  }

  otelSdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        secretKey: config.secretKey,
        publicKey: config.publicKey,
        baseUrl: config.baseUrl,
      }),
    ],
  })

  otelSdk.start()
  logger.info({ baseUrl: config.baseUrl }, "Langfuse tracing initialized")
}

/**
 * Shutdown Langfuse and OpenTelemetry SDK.
 * Call this before application shutdown.
 */
export async function shutdownLangfuse(): Promise<void> {
  if (otelSdk) {
    await otelSdk.shutdown()
    otelSdk = null
    logger.info("Langfuse tracing shutdown")
  }
}
