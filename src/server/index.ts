import express from "express"
import cookieParser from "cookie-parser"
import path from "path"
import { fileURLToPath } from "url"
import http from "http"
import pinoHttp from "pino-http"
import { routes as authRoutes, middleware as authMiddleware } from "./routes/auth"
import { createSocketIOServer } from "./websockets"
import { PORT } from "./config"
import { logger } from "./lib/logger"
import { randomUUID } from "crypto"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(express.json())
app.use(cookieParser())

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === "/health",
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error"
      if (res.statusCode >= 400) return "warn"
      return "silent" // Don't log successful requests
    },
    genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "req.headers['x-api-key']",
      ],
      censor: "[REDACTED]",
    },
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} ${res.statusCode}`
    },
    customErrorMessage: (req, res, err) => {
      return `${req.method} ${req.url} ${res.statusCode} - ${err?.message || "Error"}`
    },
  }),
)

app.get("/health", (_, res) => res.json({ status: "ok", message: "Threa API" }))

if (process.env.NODE_ENV !== "production") {
  app.get("/", (_, res) => res.redirect("http://localhost:3000"))
}

app.use("/api/auth", authRoutes)

app.use("/api/", authMiddleware)

// Serve static files from Vite build in production
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../../dist/frontend")
  app.use(express.static(distPath))

  app.get("*", (_, res) => res.sendFile(path.join(distPath, "index.html")))
}

const server = http.createServer(app)

async function startServer() {
  try {
    await createSocketIOServer(server)

    server.listen(PORT, () => {
      logger.info({ port: PORT }, "Server started")
      logger.info({ url: `http://localhost:${PORT}/api/auth/login` }, "Login endpoint")
      logger.info("Socket.IO available")
    })
  } catch (error) {
    logger.error({ err: error }, "Failed to start server")
    process.exit(1)
  }
}

startServer()
