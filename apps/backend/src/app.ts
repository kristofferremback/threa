import express, { type Express } from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import pinoHttp from "pino-http"
import { randomUUID } from "crypto"
import { logger } from "./lib/logger"

export function createApp(): Express {
  const app = express()

  app.use(cors({ origin: true, credentials: true }))
  app.use(cookieParser())
  app.use(express.json())

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/health",
      },
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return "error"
        if (res.statusCode >= 400) return "warn"
        return "silent"
      },
      genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
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

  app.get("/health", (_, res) => res.json({ status: "ok" }))

  return app
}
