const isProduction = process.env.NODE_ENV === "production"

export const parseCookies = (cookieHeader: string): Record<string, string> => {
  return cookieHeader.split(";").reduce(
    (acc, cookie) => {
      const [key, ...rest] = cookie.trim().split("=")
      const value = rest.join("=")
      if (key && value) {
        acc[key] = decodeURIComponent(value)
      }
      return acc
    },
    {} as Record<string, string>
  )
}

// Per-environment cookie name so staging and production sessions don't collide
// in a browser that has both open. Set `SESSION_COOKIE_NAME=wos_session_staging`
// in staging, leave unset (or `wos_session`) in production.
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "wos_session"

export const SESSION_COOKIE_CONFIG = {
  path: "/",
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
  // Honor COOKIE_DOMAIN whenever it's set. Staging needs this too so the
  // session set at staging.threa.io during the WorkOS callback is visible on
  // sibling PR subdomains like pr-204-staging.threa.io.
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
}
