import type { Response } from "express"
import {
  HttpError,
  MAX_ACCOUNTS,
  MAX_ALT_SLOTS,
  clearAltSessionCookie,
  clearSessionCookie,
  displayNameFromWorkos,
  readAltSessionCookies,
  setAltSessionCookie,
  setSessionCookie,
  type AuthService,
} from "@threa/backend-common"

/**
 * One account as seen by the multi-account switcher.
 *
 * `id` is a stable opaque identifier — for live accounts it is the WorkOS user
 * id; for an alt whose sealed session failed validation it is
 * `stale:alt_<slot>` (the raw slot index never crosses the wire). `state` is a
 * single discriminant because the three states are mutually exclusive: the
 * active account is always validated upstream by the `auth` middleware, so an
 * `active && stale` combination is structurally impossible.
 */
export interface AccountSummary {
  id: string
  email: string
  name: string
  state: "active" | "parked" | "stale"
}

interface ActiveUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

interface ResolvedAlt {
  slot: number
  sealed: string
  ok: boolean
  user?: { id: string; email: string; firstName: string | null; lastName: string | null }
}

interface Dependencies {
  authService: AuthService
}

const STALE_ID_RE = /^stale:alt_(\d+)$/

export class AccountsService {
  private authService: AuthService

  constructor({ authService }: Dependencies) {
    this.authService = authService
  }

  // Validate every parked alt cookie in parallel (never a serial loop). A
  // slot whose sealed session fails validation comes back `ok:false` and is
  // reclaimable on the next write (self-heals corrupt/expired alts).
  private async resolveAlts(cookies: Record<string, string>): Promise<ResolvedAlt[]> {
    const alts = readAltSessionCookies(cookies)
    const auths = await Promise.all(alts.map((a) => this.authService.authenticateSession(a.sealed)))
    return alts.map((a, i) => {
      const r = auths[i]
      return r.success && r.user
        ? { slot: a.slot, sealed: a.sealed, ok: true, user: r.user }
        : { slot: a.slot, sealed: a.sealed, ok: false }
    })
  }

  async list(
    cookies: Record<string, string>,
    activeUser: ActiveUser
  ): Promise<{ accounts: AccountSummary[]; maxAccounts: number }> {
    const accounts: AccountSummary[] = [
      {
        id: activeUser.id,
        email: activeUser.email,
        name: displayNameFromWorkos(activeUser),
        state: "active",
      },
    ]

    // Coalesce on read: hide any alt that resolves to the active account or to
    // an account already surfaced by an earlier (lower) slot. GET stays
    // Set-Cookie-free; slot reconciliation is deferred to the next write.
    const seen = new Set<string>([activeUser.id])
    for (const alt of await this.resolveAlts(cookies)) {
      if (alt.ok && alt.user) {
        if (seen.has(alt.user.id)) continue
        seen.add(alt.user.id)
        accounts.push({
          id: alt.user.id,
          email: alt.user.email,
          name: displayNameFromWorkos(alt.user),
          state: "parked",
        })
      } else {
        accounts.push({ id: `stale:alt_${alt.slot}`, email: "", name: "", state: "stale" })
      }
    }

    return { accounts, maxAccounts: MAX_ACCOUNTS }
  }

  async switch(
    res: Response,
    cookies: Record<string, string>,
    activeSealed: string,
    activeUser: ActiveUser,
    targetUserId: string
  ): Promise<{ activeUserId: string }> {
    if (targetUserId === activeUser.id) {
      throw new HttpError("Account is already active", { status: 409, code: "ALREADY_ACTIVE" })
    }

    const alts = await this.resolveAlts(cookies)
    const target = alts.find((a) => a.ok && a.user?.id === targetUserId)
    if (!target || !target.user) {
      throw new HttpError("Account not found", { status: 404, code: "ACCOUNT_NOT_FOUND" })
    }

    // Deterministic Set-Cookie order so a mid-flight failure never strands a
    // session: promote target, park the old active into the slot the target
    // just vacated (always free), then drop any duplicate slots.
    setSessionCookie(res, target.sealed)
    setAltSessionCookie(res, target.slot, activeSealed)
    for (const alt of alts) {
      if (alt.slot === target.slot || !alt.ok || !alt.user) continue
      if (alt.user.id === targetUserId || alt.user.id === activeUser.id) {
        clearAltSessionCookie(res, alt.slot)
      }
    }

    return { activeUserId: targetUserId }
  }

  async remove(
    res: Response,
    cookies: Record<string, string>,
    activeSealed: string,
    activeUser: ActiveUser,
    targetUserId: string
  ): Promise<{ removedId: string }> {
    const staleMatch = STALE_ID_RE.exec(targetUserId)
    if (staleMatch) {
      const slot = Number(staleMatch[1])
      if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ALT_SLOTS) {
        throw new HttpError("Account not found", { status: 404, code: "ACCOUNT_NOT_FOUND" })
      }
      // The sealed session already failed validation — nothing to revoke.
      clearAltSessionCookie(res, slot)
      return { removedId: targetUserId }
    }

    const alts = await this.resolveAlts(cookies)

    if (targetUserId === activeUser.id) {
      // Removing the active account: kill its WorkOS session for real, plus
      // any duplicate alt slots holding the same account, then promote the
      // lowest-slot remaining distinct account (or full logout if none).
      await this.authService.revokeSession(activeSealed)
      clearSessionCookie(res)

      const dups = alts.filter((a) => a.ok && a.user?.id === activeUser.id)
      for (const dup of dups) {
        await this.authService.revokeSession(dup.sealed)
        clearAltSessionCookie(res, dup.slot)
      }

      const promote = alts
        .filter((a) => a.ok && a.user && a.user.id !== activeUser.id)
        .sort((a, b) => a.slot - b.slot)[0]
      if (promote) {
        setSessionCookie(res, promote.sealed)
        clearAltSessionCookie(res, promote.slot)
      } else {
        // No survivor — clear every parked alt so nothing is stranded.
        for (const alt of alts) clearAltSessionCookie(res, alt.slot)
      }

      return { removedId: activeUser.id }
    }

    const matches = alts.filter((a) => a.ok && a.user?.id === targetUserId)
    if (matches.length === 0) {
      throw new HttpError("Account not found", { status: 404, code: "ACCOUNT_NOT_FOUND" })
    }
    for (const m of matches) {
      await this.authService.revokeSession(m.sealed)
      clearAltSessionCookie(res, m.slot)
    }

    return { removedId: targetUserId }
  }
}
