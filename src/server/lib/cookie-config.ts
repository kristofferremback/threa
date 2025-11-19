import { isProduction } from "../config"

/**
 * Cookie configuration for WorkOS sessions
 * 30 days to match WorkOS max session length
 */
export const SESSION_COOKIE_CONFIG = {
  path: "/",
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
}

