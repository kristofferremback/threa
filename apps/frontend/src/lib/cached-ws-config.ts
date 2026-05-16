// Per-workspace socket connection config (`{ region, wsUrl }`). The region is
// assigned at workspace creation and never moves, so the wsUrl is stable —
// caching it lets the socket connect immediately on a returning launch instead
// of blocking the connection on the `/api/workspaces/:id/config` round trip.
// The fetch still runs in the background to revalidate; if the URL changed the
// socket reconnects to the fresh one.
const STORAGE_PREFIX = "threa-ws-config"

export interface CachedWsConfig {
  region: string
  wsUrl: string
}

function key(workspaceId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}`
}

export function getCachedWsConfig(workspaceId: string): CachedWsConfig | null {
  try {
    const raw = localStorage.getItem(key(workspaceId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedWsConfig>
    if (typeof parsed?.region !== "string" || typeof parsed?.wsUrl !== "string") return null
    return { region: parsed.region, wsUrl: parsed.wsUrl }
  } catch {
    return null
  }
}

export function setCachedWsConfig(workspaceId: string, config: CachedWsConfig): void {
  try {
    localStorage.setItem(key(workspaceId), JSON.stringify(config))
  } catch {
    // Storage unavailable
  }
}
