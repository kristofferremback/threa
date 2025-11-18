import { Router, type Request, type Response, type NextFunction } from "express"
import { WorkOS } from "@workos-inc/node"
import { isProduction, WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD, WORKOS_REDIRECT_URI } from "../config"
import { logger } from "../lib/logger"

const clientId = WORKOS_CLIENT_ID
export const workos = new WorkOS(WORKOS_API_KEY, { clientId })

const redirectUri = WORKOS_REDIRECT_URI || "http://localhost:3000/api/auth/callback"

export const middleware = async (req: Request, res: Response, next: NextFunction) => {
  const sealedSession = req.cookies["wos_session"]

  const session = workos.userManagement.loadSealedSession({
    sessionData: sealedSession!,
    cookiePassword: WORKOS_COOKIE_PASSWORD!,
  })

  const authRes = await session.authenticate()
  if (authRes.authenticated) {
    ;(req as any).user = authRes.user
    return next()
  }

  if (authRes.reason === "no_session_cookie_provided") {
    return res.redirect("/api/auth/login")
  }

  try {
    const result = await session.refresh({ cookiePassword: WORKOS_COOKIE_PASSWORD! })
    if (!result.authenticated) {
      return res.redirect("/api/auth/login")
    }

    res.cookie("wos_session", result.sealedSession!, {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7 * 1000,
    })

    return res.redirect(req.originalUrl)
  } catch (error) {
    logger.error({ err: error }, "Session refresh error")
    res.clearCookie("wos_session")
    return res.redirect("/api/auth/login")
  }
}

export const routes = Router()

routes.get("/login", (req: Request, res: Response) => {
  if (req.cookies["wos_session"]) {
    logger.debug("Session cookie found, clearing for fresh login")
    res.clearCookie("wos_session")
  }

  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId,
  })

  res.redirect(authorizationUrl)
})

routes.get("/login-redirect-url", (req: Request, res: Response) => {
  if (req.cookies["wos_session"]) {
    logger.debug("Session cookie found, clearing for fresh login")
    res.clearCookie("wos_session")
  }

  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId,
  })

  res.json({ url: authorizationUrl })
})

routes.all("/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string

  if (!code) {
    return res.status(400).json({ error: "No code provided" })
  }

  try {
    logger.debug("Authenticating with code")
    const { user, sealedSession } = await workos.userManagement.authenticateWithCode({
      code,
      clientId,
      session: { sealSession: true, cookiePassword: WORKOS_COOKIE_PASSWORD! },
    })

    logger.info({ email: user.email, sealedSession: !!sealedSession }, "User authenticated")

    res.cookie("wos_session", sealedSession!, {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7 * 1000,
    })

    res.redirect("/")
  } catch (error) {
    logger.error({ err: error }, "Authentication failed")
    res.status(401).json({ error: "Authentication failed" })
  }
})

routes.post("/logout", async (req: Request, res: Response) => {
  const sealedSession = req.cookies["wos_session"]
  if (!sealedSession) {
    return res.status(400).json({ error: "No session found" })
  }

  const session = await workos.userManagement.loadSealedSession({
    sessionData: sealedSession,
    cookiePassword: WORKOS_COOKIE_PASSWORD!,
  })

  const logoutUrl = await session.getLogoutUrl()
  res.clearCookie("wos_session")
  res.redirect(logoutUrl)
})

routes.get("/me", async (req: Request, res: Response) => {
  const sealedSession = req.cookies["wos_session"]

  if (!sealedSession) {
    logger.debug("No session cookie in /me request")
    return res.status(401).json({ error: "No session found" })
  }

  const session = workos.userManagement.loadSealedSession({
    sessionData: sealedSession,
    cookiePassword: WORKOS_COOKIE_PASSWORD!,
  })

  const authRes = await session.authenticate()
  if (!authRes.authenticated) {
    logger.debug({ reason: authRes.reason }, "Session not authenticated")
    return res.status(401).json({ error: "Not authenticated" })
  }

  logger.debug({ email: authRes.user.email }, "User session verified")
  res.json(authRes.user)
})
