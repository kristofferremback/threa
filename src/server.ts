import { Hono } from "hono";
import { WorkOS } from "@workos-inc/node";

// Initialize WorkOS
const workos = new WorkOS(process.env.WORKOS_API_KEY);
const clientId = process.env.WORKOS_CLIENT_ID!;
const redirectUri = process.env.WORKOS_REDIRECT_URI || "http://localhost:3000/auth/callback";

// JWT utilities for refresh tokens
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

interface JWTPayload {
  userId: string;
  email: string;
  exp: number;
}

// Simple JWT implementation using Web Crypto API
async function createToken(payload: Omit<JWTPayload, "exp">, expiresIn: number): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, exp: now + expiresIn };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${data}.${encodedSignature}`;
}

async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const data = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signature = Uint8Array.from(atob(encodedSignature), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(data));

    if (!valid) return null;

    const payload = JSON.parse(atob(encodedPayload)) as JWTPayload;
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// In-memory session storage (replace with Redis in production)
const sessions = new Map<string, { accessToken: string; refreshToken: string; userId: string; email: string }>();

// WebSocket clients
const wsClients = new Map<string, any>();

// Create Hono app
const app = new Hono();

// Health check
app.get("/", (c) => {
  return c.json({ status: "ok", message: "Threa API" });
});

// Login - redirect to WorkOS
app.get("/auth/login", (c) => {
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId,
    redirectUri,
  });

  return c.redirect(authorizationUrl);
});

// Auth callback - handle WorkOS response
app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");

  if (!code) {
    return c.json({ error: "No code provided" }, 400);
  }

  try {
    // Exchange code for user info
    const { user, accessToken: workosAccessToken } = await workos.userManagement.authenticateWithCode({
      code,
      clientId,
    });

    // Create our own tokens
    const accessToken = await createToken(
      { userId: user.id, email: user.email },
      15 * 60 // 15 minutes
    );

    const refreshToken = await createToken(
      { userId: user.id, email: user.email },
      7 * 24 * 60 * 60 // 7 days
    );

    // Store session
    sessions.set(user.id, {
      accessToken,
      refreshToken,
      userId: user.id,
      email: user.email,
    });

    // Return HTML that stores tokens and redirects
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Login Success</title></head>
        <body>
          <script>
            localStorage.setItem('accessToken', '${accessToken}');
            localStorage.setItem('refreshToken', '${refreshToken}');
            localStorage.setItem('userId', '${user.id}');
            localStorage.setItem('email', '${user.email}');
            window.location.href = '/';
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Auth error:", error);
    return c.json({ error: "Authentication failed" }, 401);
  }
});

// Refresh token endpoint
app.post("/auth/refresh", async (c) => {
  const { refreshToken } = await c.req.json();

  if (!refreshToken) {
    return c.json({ error: "No refresh token provided" }, 400);
  }

  const payload = await verifyToken(refreshToken);

  if (!payload) {
    return c.json({ error: "Invalid refresh token" }, 401);
  }

  // Create new access token
  const accessToken = await createToken(
    { userId: payload.userId, email: payload.email },
    15 * 60 // 15 minutes
  );

  return c.json({ accessToken });
});

// Logout
app.post("/auth/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      sessions.delete(payload.userId);
      wsClients.delete(payload.userId);
    }
  }

  return c.json({ success: true });
});

// Get current user
app.get("/auth/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return c.json({ error: "No token provided" }, 401);
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  return c.json({ userId: payload.userId, email: payload.email });
});

// Serve frontend
app.get("/", (c) => {
  return c.html(Bun.file("src/index.html"));
});

// Start server with WebSocket support
const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch: app.fetch,

  // WebSocket handler
  websocket: {
    async message(ws, message) {
      const data = JSON.parse(message as string);

      // Echo messages back to all connected clients
      const userId = (ws as any).data.userId;
      console.log(`Message from ${userId}:`, data);

      // Broadcast to all clients
      for (const [clientId, client] of wsClients) {
        if (client.readyState === 1) { // OPEN
          client.send(JSON.stringify({
            type: "message",
            userId,
            email: (ws as any).data.email,
            message: data.message,
            timestamp: new Date().toISOString(),
          }));
        }
      }
    },

    async open(ws) {
      const userId = (ws as any).data.userId;
      const email = (ws as any).data.email;

      wsClients.set(userId, ws);
      console.log(`WebSocket connected: ${email}`);

      ws.send(JSON.stringify({
        type: "connected",
        message: "Connected to Threa"
      }));
    },

    async close(ws) {
      const userId = (ws as any).data.userId;
      wsClients.delete(userId);
      console.log(`WebSocket disconnected: ${userId}`);
    },
  },
});

// Handle WebSocket upgrade
app.get("/ws", async (c) => {
  const token = c.req.query("token");

  if (!token) {
    return c.json({ error: "No token provided" }, 401);
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  // Upgrade to WebSocket
  const upgraded = server.upgrade(c.req.raw, {
    data: {
      userId: payload.userId,
      email: payload.email,
    },
  });

  if (!upgraded) {
    return c.json({ error: "WebSocket upgrade failed" }, 500);
  }

  return undefined as any;
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📝 Login at http://localhost:${server.port}/auth/login`);
