import { NodeSDK } from "@opentelemetry/sdk-node"
import { LangfuseSpanProcessor } from "@langfuse/otel"
import { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL } from "../config"
import { logger } from "./logger"

let otelSdk: NodeSDK | null = null

/**
 * Check if Langfuse is configured and available.
 */
export function isLangfuseEnabled(): boolean {
  return !!(LANGFUSE_SECRET_KEY && LANGFUSE_PUBLIC_KEY)
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

  otelSdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        secretKey: LANGFUSE_SECRET_KEY,
        publicKey: LANGFUSE_PUBLIC_KEY,
        baseUrl: LANGFUSE_BASE_URL,
      }),
    ],
  })

  otelSdk.start()
  logger.info({ baseUrl: LANGFUSE_BASE_URL }, "Langfuse tracing initialized")
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
