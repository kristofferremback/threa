import { Hono } from "hono";
import { verifyToken } from "./lib/jwt";
import { wsClients } from "./lib/storage";
import { authRoutes } from "./routes/auth";
import type { WSData } from "./lib/types";

// Create Hono app
const app = new Hono();

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", message: "Threa API" });
});

// Mount auth routes
app.route("/auth", authRoutes);

// Serve frontend
app.get("/", (c) => {
  return c.html(Bun.file("src/index.html"));
});

// Start server with WebSocket support
const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch: async (req, server) => {
    // Handle WebSocket upgrade with token in Sec-WebSocket-Protocol header
    if (req.headers.get("upgrade") === "websocket") {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        // Extract token from Sec-WebSocket-Protocol header
        // Format: "access_token.{jwt_token}"
        const protocols = req.headers.get("sec-websocket-protocol");

        if (!protocols) {
          return new Response("No token provided", { status: 401 });
        }

        // The token is passed in the protocol header
        // We prefix it with "access_token." to make it a valid subprotocol
        const token = protocols.startsWith("access_token.")
          ? protocols.slice("access_token.".length)
          : protocols;

        const payload = await verifyToken(token);

        if (!payload) {
          return new Response("Invalid token", { status: 401 });
        }

        // Upgrade to WebSocket with user data
        const upgraded = server.upgrade(req, {
          data: {
            userId: payload.userId,
            email: payload.email,
          } as WSData,
        });

        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }

        return undefined as any;
      }
    }

    // Handle normal HTTP requests
    return app.fetch(req, server);
  },

  // WebSocket handler
  websocket: {
    async message(ws, message) {
      const data = JSON.parse(message as string);
      const wsData = ws.data as WSData;

      // Echo messages back to all connected clients
      console.log(`Message from ${wsData.userId}:`, data);

      // Broadcast to all clients
      for (const [_clientId, client] of wsClients) {
        if (client.readyState === 1) {
          // OPEN
          client.send(
            JSON.stringify({
              type: "message",
              userId: wsData.userId,
              email: wsData.email,
              message: data.message,
              timestamp: new Date().toISOString(),
            })
          );
        }
      }
    },

    async open(ws) {
      const wsData = ws.data as WSData;

      wsClients.set(wsData.userId, ws);
      console.log(`WebSocket connected: ${wsData.email}`);

      ws.send(
        JSON.stringify({
          type: "connected",
          message: "Connected to Threa",
        })
      );
    },

    async close(ws) {
      const wsData = ws.data as WSData;
      wsClients.delete(wsData.userId);
      console.log(`WebSocket disconnected: ${wsData.userId}`);
    },
  },
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📝 Login at http://localhost:${server.port}/auth/login`);
