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

// Switch + remove identify accounts by `targetUserId` (stable across slot
// renumbering from concurrent add/switch/remove in other tabs). Dead alts
// expose no userId to the client — they can only be addressed by slot index,
// so `remove` also accepts a `slot` fallback for those.
const switchSchema = z.object({
  targetUserId: z.string().min(1),
})

const removeSchema = z.union([
  z.object({ targetUserId: z.string().min(1) }),
  z.object({
    slot: z
      .number()
      .int()
      .min(0)
      .max(MAX_ALT_SLOTS - 1),
  }),
])

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
     *
     * Identified by `targetUserId` rather than slot index so concurrent
     * add/remove activity in another tab can't shift the index out from under
     * a stale switch request.
     */
    async switch(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const parsed = switchSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid target", { status: 400, code: "INVALID_TARGET" })
      }
      const { targetUserId } = parsed.data

      // No-op if already active.
      if (req.authUser.id === targetUserId) {
        return res.status(204).end()
      }

      const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
      let matchedSlot = -1
      let matchedAuth: Awaited<ReturnType<AuthService["authenticateSession"]>> | null = null
      let matchedSealed: string | null = null
      for (let i = 0; i < altCookies.length; i++) {
        const sealed = altCookies[i]
        if (!sealed) continue
        const auth = await authService.authenticateSession(sealed)
        if (auth.success && auth.user?.id === targetUserId) {
          matchedSlot = i
          matchedAuth = auth
          matchedSealed = sealed
          break
        }
      }

      if (matchedSlot === -1 || !matchedAuth?.user || !matchedSealed) {
        throw new HttpError("No parked account matches that user", {
          status: 404,
          code: "TARGET_NOT_FOUND",
        })
      }

      // Refreshed-during-auth: if WorkOS rotated the sealed session, use the
      // new value so the cookie we install reflects the fresh refresh token.
      const newActive = matchedAuth.refreshed && matchedAuth.sealedSession ? matchedAuth.sealedSession : matchedSealed
      const currentActive = req.cookies[SESSION_COOKIE_NAME] as string | undefined

      if (currentActive) {
        setAltSessionCookie(res, matchedSlot, currentActive)
      } else {
        clearAltSessionCookie(res, matchedSlot)
      }
      setSessionCookie(res, newActive)

      res.json({
        active: {
          userId: matchedAuth.user.id,
          email: matchedAuth.user.email,
          name: displayNameFromWorkos(matchedAuth.user),
        },
      })
    },

    /**
     * POST /api/accounts/remove — drop an account from the jar.
     *
     * Body accepts:
     * - `{ targetUserId }`: stable identifier for an authenticated account
     *   (active or parked). If it matches the active user, the active cookie
     *   is cleared and the lowest-indexed parked alt is promoted; otherwise
     *   the matching alt slot is cleared.
     * - `{ slot }`: numeric fallback for dead alts, which expose no userId.
     *
     * Returns the new active account summary, or `null` if the user is now
     * fully logged out.
     */
    async remove(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const parsed = removeSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid target", { status: 400, code: "INVALID_TARGET" })
      }
      const data = parsed.data

      // Dead-alt removal: client-supplied slot index is the only handle they
      // have on an alt that doesn't authenticate. Clear it and best-effort
      // revoke at WorkOS in case the sealed session still partially decodes.
      if ("slot" in data) {
        const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
        const sealed = altCookies[data.slot]
        if (sealed) {
          await authService.getLogoutUrl(sealed).catch(() => null)
        }
        clearAltSessionCookie(res, data.slot)
        return res.json({
          active: {
            userId: req.authUser.id,
            email: req.authUser.email,
            name: displayNameFromWorkos(req.authUser),
          },
        })
      }

      const { targetUserId } = data

      // Active-user removal: revoke + promote lowest parked alt.
      if (req.authUser.id === targetUserId) {
        const active = req.cookies[SESSION_COOKIE_NAME] as string | undefined
        if (active) {
          // Best-effort refresh-token revocation. getLogoutUrl side-effects
          // the revocation on WorkOS; we don't redirect through it.
          await authService.getLogoutUrl(active).catch(() => null)
        }
        clearSessionCookie(res)

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

        return res.json({ active: null })
      }

      // Parked-alt removal by userId: walk alts, match, clear.
      const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
      for (let i = 0; i < altCookies.length; i++) {
        const sealed = altCookies[i]
        if (!sealed) continue
        const auth = await authService.authenticateSession(sealed)
        if (auth.success && auth.user?.id === targetUserId) {
          await authService.getLogoutUrl(sealed).catch(() => null)
          clearAltSessionCookie(res, i)
          return res.json({
            active: {
              userId: req.authUser.id,
              email: req.authUser.email,
              name: displayNameFromWorkos(req.authUser),
            },
          })
        }
      }

      throw new HttpError("No account matches that user", {
        status: 404,
        code: "TARGET_NOT_FOUND",
      })
    },
  }
}

// Re-export for tests that want to assert on cookie naming.
export { altSessionCookieName }
