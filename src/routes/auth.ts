import { Hono } from "hono";
import { WorkOS } from "@workos-inc/node";
import { createToken, verifyToken } from "../lib/jwt";
import { sessions, wsClients } from "../lib/storage";

// Initialize WorkOS
const workos = new WorkOS(process.env.WORKOS_API_KEY);
const clientId = process.env.WORKOS_CLIENT_ID!;
const redirectUri = process.env.WORKOS_REDIRECT_URI || "http://localhost:3000/auth/callback";

export const authRoutes = new Hono();

// Login - redirect to WorkOS
authRoutes.get("/login", (c) => {
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId,
    redirectUri,
  });

  return c.redirect(authorizationUrl);
});

// Auth callback - handle WorkOS response
authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");

  if (!code) {
    return c.json({ error: "No code provided" }, 400);
  }

  try {
    // Exchange code for user info
    const { user } = await workos.userManagement.authenticateWithCode({
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
authRoutes.post("/refresh", async (c) => {
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
authRoutes.post("/logout", async (c) => {
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
authRoutes.get("/me", async (c) => {
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
