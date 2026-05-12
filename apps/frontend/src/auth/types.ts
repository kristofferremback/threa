export interface User {
  id: string
  email: string
  name: string
}

/** Slot index for a parked alt account (0..6). The active account uses the string `"active"`. */
export type AccountSlot = "active" | number

/**
 * One entry in the multi-account jar. `slot === "active"` is the currently-active
 * account; numeric slots are parked alts.
 *
 * `status`:
 * - "active" — the request the page made is authenticated as this user
 * - "parked" — alt cookie present and authenticates cleanly (one cookie-swap away)
 * - "dead"   — alt cookie present but no longer authenticates; needs re-auth
 */
export interface AccountSummary {
  slot: AccountSlot
  userId: string | null
  email: string | null
  name: string | null
  status: "active" | "parked" | "dead"
}

export interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  accounts: AccountSummary[]
  maxAccounts: number
}
