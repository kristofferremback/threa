// The build version we've already surfaced the "new version available" toast
// for. `AppUpdateChecker` (inside `WorkspaceLayout`) remounts on workspace
// switch and layout route changes, and its check re-fires on every tab focus,
// socket reconnect, and 5-min poll. A purely in-memory guard resets on those
// remounts, so a single deploy the user doesn't immediately reload past gets
// re-toasted repeatedly. Persisting the notified version dedupes to at most
// one toast per distinct build across remounts and sessions; a genuinely newer
// build (whose version won't match this marker) still notifies.
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
