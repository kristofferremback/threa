import express, { type Express } from "express"
import cors from "cors"
import helmet from "helmet"
import cookieParser from "cookie-parser"
import pinoHttp from "pino-http"
import { randomUUID } from "crypto"
import { logger, createCorsOriginChecker } from "@threa/backend-common"

interface CreateAppOptions {
  corsAllowedOrigins: string[]
}

export function createApp(options: CreateAppOptions): Express {
  const app = express()
  const isProduction = process.env.NODE_ENV === "production"
  const requestLoggingIgnoredPaths = ["/health", "/readyz"]

  app.set("trust proxy", 1)
  app.disable("x-powered-by")

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
      frameguard: { action: "deny" },
      hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  )

  app.use(cors({ origin: createCorsOriginChecker(options.corsAllowedOrigins), credentials: true }))
  app.use(cookieParser())
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => requestLoggingIgnoredPaths.includes(req.url),
      },
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return "error"
        if (res.statusCode >= 400) return "warn"
        return "silent"
      },
      genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
        censor: "[REDACTED]",
      },
    })
  )

  app.get("/health", (_, res) => res.json({ status: "ok" }))

  return app
}
