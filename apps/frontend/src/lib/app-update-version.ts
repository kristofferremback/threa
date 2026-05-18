// The build version we've already surfaced the "new version available" toast
// for. The toast's only in-memory guard is a per-mount ref, but its host
// (`AppUpdateChecker` inside `WorkspaceLayout`) remounts on workspace switch
// and layout route changes, and the check re-fires on every tab focus, socket
// reconnect, and 5-min poll. Without a stable marker, a single deploy the user
// doesn't immediately reload past gets re-toasted on every remount + trigger.
// Persisting the notified version dedupes to at most one toast per distinct
// build, across remounts and sessions, while a genuinely newer build (whose
// version won't match this marker) still notifies.
const STORAGE_KEY = "threa-app-update-notified-version"

export function getNotifiedVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setNotifiedVersion(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version)
  } catch {
    // Storage unavailable — degrades to per-mount dedup, no worse than before.
  }
}
