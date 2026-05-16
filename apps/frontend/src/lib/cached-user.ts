import type { User } from "@/auth/types"

// The session credential is the httpOnly WorkOS cookie — never this value.
// We cache only the display identity so a returning user renders instantly
// from local state while `/api/auth/me` revalidates in the background. A 401
// on revalidation clears this and bounces to login; a network failure keeps
// it so the app stays usable offline / on a flaky connection.
const STORAGE_KEY = "threa-cached-user"

export function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<User>
    if (typeof parsed?.id !== "string" || typeof parsed?.email !== "string" || typeof parsed?.name !== "string") {
      return null
    }
    return { id: parsed.id, email: parsed.email, name: parsed.name }
  } catch {
    return null
  }
}

export function setCachedUser(user: User): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: user.id, email: user.email, name: user.name }))
  } catch {
    // Storage unavailable — degrade to network-first auth, no crash.
  }
}

export function clearCachedUser(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable
  }
}
