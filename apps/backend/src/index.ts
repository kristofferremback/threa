// MUST be first - OTEL needs to instrument LangChain before it loads
import { initLangfuse, shutdownLangfuse } from "./lib/langfuse"
initLangfuse()

import { startServer } from "./server"
import { logger } from "./lib/logger"

const { server, stop } = await startServer()

// Prevent multiple shutdown attempts
let isShuttingDown = false
async function shutdown(code: number) {
  if (isShuttingDown) return
  isShuttingDown = true
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
  logger.fatal({ reason }, "Unhandled rejection")
  shutdown(1)
})
