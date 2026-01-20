// MUST be first - OTEL needs to instrument LangChain before it loads
import { initLangfuse, shutdownLangfuse } from "./lib/langfuse"
initLangfuse()

import { startServer } from "./server"
import { logger } from "./lib/logger"

const { server, stop, isDevelopment } = await startServer()

if (isDevelopment) {
  logger.info("Running in development mode - graceful shutdown disabled")
}

// Prevent multiple shutdown attempts
let isShuttingDown = false
async function shutdown(code: number) {
  if (isShuttingDown) return
  isShuttingDown = true

  // In development mode, skip graceful shutdown for immediate termination
  if (isDevelopment) {
    logger.info("Development mode - skipping graceful shutdown")
    process.exit(code)
  }

  await stop()
  await shutdownLangfuse()
  process.exit(code)
}

// Handle graceful shutdown
process.on("SIGTERM", () => shutdown(0))
process.on("SIGINT", () => shutdown(0))
process.on("SIGHUP", () => shutdown(0))

// Last-ditch cleanup on crashes
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception")
  shutdown(1)
})

process.on("unhandledRejection", (reason) => {
  // Try to extract useful info from the rejection reason
  let reasonInfo: Record<string, unknown>
  if (reason instanceof Error) {
    reasonInfo = { message: reason.message, stack: reason.stack, name: reason.name }
  } else if (typeof reason === "object" && reason !== null) {
    try {
      reasonInfo = { ...reason, stringified: JSON.stringify(reason) }
    } catch {
      // JSON.stringify can throw for circular refs, BigInt, etc.
      reasonInfo = { value: String(reason) }
    }
  } else {
    reasonInfo = { value: String(reason) }
  }
  logger.fatal({ reason: reasonInfo }, "Unhandled rejection")
  shutdown(1)
})
