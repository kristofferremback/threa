import { startServer } from "./server"

const { server, stop } = await startServer()

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  await stop()
  process.exit(0)
})

process.on("SIGINT", async () => {
  await stop()
  process.exit(0)
})
