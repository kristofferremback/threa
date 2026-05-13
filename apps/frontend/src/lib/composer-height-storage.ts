/**
 * Persists the last-measured composer height and applies it as a global
 * fallback CSS variable on `:root` before the editor zone mounts.
 *
 * Why: the timeline's footer spacer reserves vertical space for the floating
 * composer pill via `var(--composer-height, 0px)`. That variable is set by
 * `useComposerHeightPublish` on the nearest `[data-editor-zone]` ancestor —
 * but the ResizeObserver runs inside `useEffect`, after the first commit.
 * Until then the fallback (0px) wins, and the footer spacer grows from 0 to
 * ~80px on first paint. Inside Virtuoso's `stickToBottom` mode that growth
 * forces the list to shift content up by the same amount, which the user
 * sees as the timeline "jumping" on every hard refresh.
 *
 * Persisting the last-known height to `localStorage` and applying it to
 * `:root` before React mounts means the first render of the spacer already
 * reserves roughly the right space. The editor-zone override that runs in
 * the composer's effect later corrects any drift without a visible jump.
 */

const STORAGE_KEY = "threa:composer-height"
const CSS_VAR = "--composer-height"

// Sensible default when nothing has been persisted yet (e.g. brand-new
// install). Matches the composer's empty-state height on standard density.
const DEFAULT_HEIGHT_PX = 80

// Bounds that filter out clearly-bogus values from `localStorage` (corrupt
// data, future viewport changes that no longer reflect the current chrome).
// Inside this window the persisted value is "close enough" that the
// post-mount correction is sub-pixel from the user's perspective.
const MIN_HEIGHT_PX = 40
const MAX_HEIGHT_PX = 400

function readPersisted(): number | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return null
    if (parsed < MIN_HEIGHT_PX || parsed > MAX_HEIGHT_PX) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Reads the persisted composer height (if any) and applies it as the global
 * `--composer-height` fallback on `:root`. Called once at app boot from
 * `main.tsx`. Safe to call before React mounts.
 */
export function applyPersistedComposerHeight(): void {
  if (typeof document === "undefined") return
  const persisted = readPersisted() ?? DEFAULT_HEIGHT_PX
  document.documentElement.style.setProperty(CSS_VAR, `${persisted}px`)
}

/**
 * Persists a freshly-measured composer height for the next page load.
 * No-op when the value is outside the sanity window so corrupt measurements
 * (e.g. during a transient layout glitch) don't poison subsequent boots.
 */
export function persistComposerHeight(heightPx: number): void {
  if (typeof localStorage === "undefined") return
  const rounded = Math.round(heightPx)
  if (rounded < MIN_HEIGHT_PX || rounded > MAX_HEIGHT_PX) return
  try {
    localStorage.setItem(STORAGE_KEY, String(rounded))
  } catch {
    // Storage quota / private-mode failures shouldn't crash the render path.
  }
}
