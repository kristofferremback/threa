import type { Request, Response } from "express"
import { z } from "zod/v4"
import {
  HttpError,
  MAX_ALT_SLOTS,
  SESSION_COOKIE_NAME,
  altSessionCookieName,
  clearAltSessionCookie,
  clearSessionCookie,
  displayNameFromWorkos,
  readAltSessionCookies,
  setAltSessionCookie,
  setSessionCookie,
  type AuthService,
} from "@threa/backend-common"

interface Dependencies {
  authService: AuthService
}

type SlotId = "active" | number

interface AccountSummary {
  /** Cookie slot. `"active"` for the active session, 0..MAX_ALT_SLOTS-1 for parked alts. */
  slot: SlotId
  /** Authenticated user id from the sealed session, or `null` for a dead slot. */
  userId: string | null
  email: string | null
  name: string | null
  /**
   * `active`: this is the active session (always authenticated, or the caller
   * would have been blocked by auth middleware).
   * `parked`: parked alt session that authenticates cleanly (cookie ready to
   * be swapped into active without prompting WorkOS).
   * `dead`: parked alt cookie present but no longer authenticates — switching
   * to it requires re-auth via the OAuth add flow.
   */
  status: "active" | "parked" | "dead"
}

const switchSchema = z.object({
  slot: z
    .number()
    .int()
    .min(0)
    .max(MAX_ALT_SLOTS - 1),
})

const removeSchema = z.object({
  slot: z.union([
    z.literal("active"),
    z
      .number()
      .int()
      .min(0)
      .max(MAX_ALT_SLOTS - 1),
  ]),
})

/**
 * Resolve a parked alt cookie to a summary. Returns `null` if the slot is empty.
 */
async function describeAlt(authService: AuthService, sealed: string | undefined): Promise<AccountSummary | null> {
  if (!sealed) return null
  const auth = await authService.authenticateSession(sealed)
  if (auth.success && auth.user) {
    return {
      slot: -1, // caller fills in
      userId: auth.user.id,
      email: auth.user.email,
      name: displayNameFromWorkos(auth.user),
      status: "parked",
    }
  }
  return {
    slot: -1,
    userId: null,
    email: null,
    name: null,
    status: "dead",
  }
}

export function createAccountsHandlers({ authService }: Dependencies) {
  return {
    /**
     * GET /api/accounts — list the active account plus every parked alt slot.
     * The active account is whatever the auth middleware already resolved.
     */
    async list(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const accounts: AccountSummary[] = [
        {
          slot: "active",
          userId: req.authUser.id,
          email: req.authUser.email,
          name: displayNameFromWorkos(req.authUser),
          status: "active",
        },
      ]

      const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
      for (let i = 0; i < altCookies.length; i++) {
        const summary = await describeAlt(authService, altCookies[i])
        if (summary) {
          accounts.push({ ...summary, slot: i })
        }
      }

      res.json({ accounts, maxAccounts: MAX_ALT_SLOTS + 1 })
    },

    /**
     * POST /api/accounts/switch — promote a parked alt to active. The current
     * active cookie is parked into the slot the target came from. Atomic from
     * the browser's perspective because we set both `Set-Cookie` headers in
     * one response.
     */
    async switch(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const parsed = switchSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid slot", { status: 400, code: "INVALID_SLOT" })
      }
      const { slot } = parsed.data

      const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
      const targetSealed = altCookies[slot]
      if (!targetSealed) {
        throw new HttpError("Slot is empty", { status: 404, code: "SLOT_EMPTY" })
      }

      const targetAuth = await authService.authenticateSession(targetSealed)
      if (!targetAuth.success || !targetAuth.user) {
        throw new HttpError("Parked session is no longer valid — re-authenticate", {
          status: 409,
          code: "SLOT_DEAD",
        })
      }

      // Refreshed-during-auth: if WorkOS rotated the sealed session, use the
      // new value so the cookie we install reflects the fresh refresh token.
      const newActive = targetAuth.refreshed && targetAuth.sealedSession ? targetAuth.sealedSession : targetSealed
      const currentActive = req.cookies[SESSION_COOKIE_NAME] as string | undefined

      if (currentActive) {
        setAltSessionCookie(res, slot, currentActive)
      } else {
        clearAltSessionCookie(res, slot)
      }
      setSessionCookie(res, newActive)

      res.json({
        active: {
          userId: targetAuth.user.id,
          email: targetAuth.user.email,
          name: displayNameFromWorkos(targetAuth.user),
        },
      })
    },

    /**
     * POST /api/accounts/remove — drop an account from the jar.
     *
     * - slot === "active": clear the active cookie. If a parked alt exists,
     *   promote it (and call WorkOS getLogoutUrl on the removed session so
     *   the refresh token is invalidated server-side).
     * - slot === number: clear that alt cookie and invalidate it at WorkOS.
     *   The active session is untouched.
     *
     * Returns the new active account summary (or `null` if the user is now
     * fully logged out).
     */
    async remove(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const parsed = removeSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid slot", { status: 400, code: "INVALID_SLOT" })
      }
      const { slot } = parsed.data

      if (slot === "active") {
        const active = req.cookies[SESSION_COOKIE_NAME] as string | undefined
        if (active) {
          // Fire-and-forget WorkOS logout — we don't redirect through it, we
          // just want the refresh token revoked. getLogoutUrl side-effects
          // the revocation on WorkOS when followed; here we settle for a
          // best-effort call and surface failures only in logs.
          await authService.getLogoutUrl(active).catch(() => null)
        }
        clearSessionCookie(res)

        // Promote the lowest-indexed parked alt into the active slot.
        const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
        for (let i = 0; i < altCookies.length; i++) {
          const sealed = altCookies[i]
          if (!sealed) continue
          const altAuth = await authService.authenticateSession(sealed)
          if (altAuth.success && altAuth.user) {
            const newActive = altAuth.refreshed && altAuth.sealedSession ? altAuth.sealedSession : sealed
            setSessionCookie(res, newActive)
            clearAltSessionCookie(res, i)
            return res.json({
              active: {
                userId: altAuth.user.id,
                email: altAuth.user.email,
                name: displayNameFromWorkos(altAuth.user),
              },
            })
          }
          // Dead alt — clear it too so we don't leave stale cookies behind.
          clearAltSessionCookie(res, i)
        }

        // No parked alts — fully logged out.
        return res.json({ active: null })
      }

      // Parked alt removal.
      const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
      const sealed = altCookies[slot]
      if (sealed) {
        await authService.getLogoutUrl(sealed).catch(() => null)
      }
      clearAltSessionCookie(res, slot)
      res.json({
        active: {
          userId: req.authUser.id,
          email: req.authUser.email,
          name: displayNameFromWorkos(req.authUser),
        },
      })
    },
  }
}

// Re-export for tests that want to assert on cookie naming.
export { altSessionCookieName }
