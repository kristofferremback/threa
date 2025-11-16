import { Hono } from "hono";
import { Server } from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import { verifyToken } from "./lib/jwt";
import { authRoutes } from "./routes/auth";
import index from "./index.html";

// Create Socket.IO server
const io = new Server();

// Create Bun engine
const engine = new Engine();

// Bind Socket.IO to Bun engine
io.bind(engine);

// Authentication middleware
io.use(async (socket, next) => {
  try {
    // Extract token from auth handshake
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("No token provided"));
    }

    const payload = await verifyToken(token);

    if (!payload) {
      return next(new Error("Invalid token"));
    }

    // Attach user data to socket
    socket.data.userId = payload.userId;
    socket.data.email = payload.email;

    next();
  } catch (error) {
    next(new Error("Authentication failed"));
  }
});

// Socket.IO connection handler
io.on("connection", (socket) => {
  const userId = socket.data.userId;
  const email = socket.data.email;

  console.log(`WebSocket connected: ${email} (${userId})`);

  // Send welcome message
  socket.emit("connected", {
    message: "Connected to Threa",
  });

  // Handle chat messages
  socket.on("message", (data) => {
    console.log(`Message from ${email}:`, data);

    // Broadcast to all clients
    io.emit("message", {
      userId,
      email,
      message: data.message,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`WebSocket disconnected: ${email}`);
  });
});

// Create Hono app
const app = new Hono();

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", message: "Threa API" });
});

// Mount auth routes
app.route("/auth", authRoutes);

// Get WebSocket handler from engine
const { websocket } = engine.handler();

const port = process.env.PORT || 3000;

console.log(`🚀 Server running on http://localhost:${port}`);
console.log(`📝 Login at http://localhost:${port}/auth/login`);

// Export Bun server config
export default {
  port,
  idleTimeout: 30, // Must be greater than Socket.IO pingInterval (25s)

  fetch(req: Request, server: any) {
    const url = new URL(req.url);

    // Handle Socket.IO requests
    if (url.pathname.startsWith("/socket.io/")) {
      return engine.handleRequest(req, server);
    }

    // Handle HTTP requests with Hono
    return app.fetch(req, server);
  },

  websocket,

  // Use Bun's routes for automatic React bundling
  routes: {
    "/": index,
  },
};
