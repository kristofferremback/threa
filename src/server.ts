import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { Server } from "socket.io";
import { Engine } from "@socket.io/bun-engine";
import { verifyToken } from "./lib/jwt";
import { authRoutes } from "./routes/auth";

// Create Hono app
const app = new Hono();

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", message": "Threa API" });
});

// Mount auth routes
app.route("/auth", authRoutes);

// Serve frontend - use serveStatic
app.get("/", serveStatic({ path: "src/index.html" }));

// Start server
const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch: app.fetch,
});

// Create Socket.IO server with Bun engine
const io = new Server({
  engine: Engine,
});

// Attach Socket.IO to Bun server
io.attach(server);

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

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📝 Login at http://localhost:${server.port}/auth/login`);
