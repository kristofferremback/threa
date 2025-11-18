import { CookieMap, serve } from "bun"
import { Hono } from "hono"
import { logger } from "hono/logger"
import { routes as authRoutes, middleware as authMiddleware, workos } from "./routes/auth"
import index from "../frontend/index.html"
import { createWebsocketServer } from "./websockets"
import { PORT } from "./config"

const app = new Hono()

// Add logging middleware
app.use("*", logger())

// Custom middleware to log cookies and headers
app.use("*", async (c, next) => {
  console.log("\n=== Request Debug ===")
  console.log(`${c.req.method} ${c.req.url}`)
  const cookies = new CookieMap(c.req.header("cookie"))
  console.log("Cookies:", JSON.stringify(Object.fromEntries(cookies), null, 2))

  await next()

  console.log("Response status:", c.res.status)
  console.log("Set-Cookie header:", c.res.headers.get("set-cookie"))
  console.log("===================\n")
})

app.get("/health", (c) => {
  return c.json({ status: "ok", message: "Threa API" })
})
app.route("/api/auth", authRoutes)

// Protect all /api/* routes except /api/auth/*
app.use("/api/", authMiddleware)

const { engine } = createWebsocketServer(workos)
const ioHandler = engine.handler()

const port = PORT

console.log(`🚀 Server running on http://localhost:${port}`)
console.log(`📝 Login at http://localhost:${port}/api/auth/login`)

serve({
  port,
  idleTimeout: 30, // Must be greater than Socket.IO pingInterval (25s)

  websocket: ioHandler.websocket,

  // Use Bun's routes for automatic React bundling
  routes: {
    "/socket.io/*": (req, server) => ioHandler.fetch(req, server),
    "/api/*": (req) => app.fetch(req),
    "/*": index,
  },
})
