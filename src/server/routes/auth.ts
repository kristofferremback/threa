import { Hono, type Context, type MiddlewareHandler } from "hono"
import { WorkOS } from "@workos-inc/node"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { isProduction, WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD, WORKOS_REDIRECT_URI } from "../config"

const clientId = WORKOS_CLIENT_ID
export const workos = new WorkOS(WORKOS_API_KEY, { clientId })

const redirectUri = WORKOS_REDIRECT_URI || "http://localhost:3000/api/auth/callback"

export const middleware: MiddlewareHandler = async (c, next) => {
  const session = workos.userManagement.loadSealedSession({
    sessionData: getCookie(c, "wos_session")!,
    cookiePassword: WORKOS_COOKIE_PASSWORD!,
  })

  const authRes = await session.authenticate()
  if (authRes.authenticated) {
    c.set("user", authRes.user)
    authRes.user
    return next()
  }

  if (authRes.reason === "no_session_cookie_provided") {
    return c.redirect("/api/auth/login")
  }

  try {
    const res = await session.refresh({ cookiePassword: WORKOS_COOKIE_PASSWORD! })
    if (!res.authenticated) {
      return c.redirect("/api/auth/login")
    }

    setCookie(c, "wos_session", res.sealedSession!, {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    // This seems to be how WorkOS recommends it's handled since all its examples
    // do exactly this after refreshing a session.
    return c.redirect(c.req.url)
  } catch (error) {
    console.error("Session refresh error:", error)
    deleteCookie(c, "wos_session")

    return c.redirect("/api/auth/login")
  }
}

export const routes = new Hono()

routes.get("/login", (c) => {
  if (getCookie(c, "wos_session")) {
    console.log("🍪 Session cookie found, deleting for fresh login")
    deleteCookie(c, "wos_session")
  }

  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId,
  })

  return c.redirect(authorizationUrl)
})

routes.get("/login-redirect-url", (c) => {
  if (getCookie(c, "wos_session")) {
    console.log("🍪 Session cookie found, deleting for fresh login")
    deleteCookie(c, "wos_session")
  }

  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId,
  })

  return c.json({ url: authorizationUrl })
})

routes.all("/callback", async (c) => {
  const code = c.req.query("code")

  if (!code) {
    return c.json({ error: "No code provided" }, 400)
  }

  try {
    console.log("🔐 Authenticating with code...")
    const { user, sealedSession } = await workos.userManagement.authenticateWithCode({
      code,
      clientId,
      session: { sealSession: true, cookiePassword: WORKOS_COOKIE_PASSWORD! },
    })

    console.log("✅ Authenticated user:", user.email)
    console.log("📦 Sealed session:", sealedSession ? "present" : "missing")
    console.log("🍪 Setting cookie with secure:", isProduction)

    setCookie(c, "wos_session", sealedSession!, {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    console.log("🔄 Redirecting to /")

    return c.redirect("/")
  } catch (error) {
    console.error("❌ Auth error:", error)
    return c.json({ error: "Authentication failed" }, 401)
  }
})

routes.post("/logout", async (c) => {
  const sealedSession = getCookie(c, "wos_session")
  if (!sealedSession) {
    // Should we just return as if we're OK?
    return c.json({ error: "No session found" }, 400)
  }

  const session = await workos.userManagement.loadSealedSession({
    sessionData: sealedSession,
    cookiePassword: WORKOS_COOKIE_PASSWORD!,
  })

  const logoutUrl = await session.getLogoutUrl()
  deleteCookie(c, "wos_session")

  return c.redirect(logoutUrl)
})

routes.get("/me", async (c) => {
  console.log("🔍 /me endpoint called")
  const sealedSession = getCookie(c, "wos_session")
  console.log("🍪 Cookie value:", sealedSession ? "present" : "missing")

  if (!sealedSession) {
    console.log("❌ No session cookie found")
    return c.json({ error: "No session found" }, 401)
  }

  const session = await workos.userManagement.loadSealedSession({
    sessionData: sealedSession,
    cookiePassword: WORKOS_COOKIE_PASSWORD!,
  })

  const authRes = await session.authenticate()
  if (!authRes.authenticated) {
    // if (authRes.reason === "invalid_jwt") {
    //   console.log("❌ Invalid JWT detected, deleting cookie")
    //   deleteCookie(c, "wos_session")
    // }

    console.log("❌ Session not authenticated:", authRes.reason)
    return c.json({ error: "Not authenticated" }, 401)
  }

  console.log("✅ User authenticated:", authRes.user.email)
  return c.json(authRes.user)
})
