interface Env {
  WORKSPACE_REGIONS: KVNamespace
  /** JSON map of region name → { apiUrl, wsUrl } */
  REGIONS: string
  /** Fallback region when workspace is not in KV (required for local dev) */
  DEFAULT_REGION?: string
}

interface RegionConfig {
  apiUrl: string
  wsUrl: string
}

type RegionsMap = Record<string, RegionConfig>

/** Matches /api/workspaces/:workspaceId/... (with at least one more path segment) */
const WORKSPACE_ROUTE_RE = /^\/api\/workspaces\/([^/]+)\/.+$/

/** Matches /api/files/avatars/:workspaceId/... */
const AVATAR_ROUTE_RE = /^\/api\/files\/avatars\/([^/]+)\/.+$/

/** Matches /api/workspaces/:workspaceId/config exactly */
const CONFIG_ROUTE_RE = /^\/api\/workspaces\/([^/]+)\/config$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const regions = parseRegions(env.REGIONS)
    const url = new URL(request.url)
    const path = url.pathname

    // Router health check (handled locally, not proxied)
    if (path === "/readyz" && request.method === "GET") {
      return new Response("OK", { status: 200 })
    }

    // Config endpoint: returns the direct WebSocket URL for a workspace
    const configMatch = path.match(CONFIG_ROUTE_RE)
    if (configMatch && request.method === "GET") {
      return handleConfigRequest(configMatch[1], regions, env)
    }

    // Workspace-scoped API routes
    const workspaceMatch = path.match(WORKSPACE_ROUTE_RE)
    if (workspaceMatch) {
      return routeWorkspaceRequest(request, workspaceMatch[1], regions, env)
    }

    // Avatar file routes (workspace-scoped but different path structure)
    const avatarMatch = path.match(AVATAR_ROUTE_RE)
    if (avatarMatch) {
      return routeWorkspaceRequest(request, avatarMatch[1], regions, env)
    }

    // Non-workspace routes (auth, workspace list/create, ops) → default region
    return routeToDefaultRegion(request, regions, env)
  },
}

function parseRegions(raw: string): RegionsMap {
  try {
    return JSON.parse(raw) as RegionsMap
  } catch {
    return {}
  }
}

async function resolveRegion(workspaceId: string, env: Env): Promise<string | null> {
  const kvRegion = await env.WORKSPACE_REGIONS.get(workspaceId)
  if (kvRegion) return kvRegion
  return env.DEFAULT_REGION ?? null
}

function getRegionConfig(region: string, regions: RegionsMap): RegionConfig | null {
  return regions[region] ?? null
}

async function handleConfigRequest(workspaceId: string, regions: RegionsMap, env: Env): Promise<Response> {
  const region = await resolveRegion(workspaceId, env)
  if (!region) {
    return errorResponse(404, "Workspace not found")
  }

  const config = getRegionConfig(region, regions)
  if (!config) {
    return errorResponse(502, "Region not configured")
  }

  return Response.json({ region, wsUrl: config.wsUrl })
}

async function routeWorkspaceRequest(
  request: Request,
  workspaceId: string,
  regions: RegionsMap,
  env: Env
): Promise<Response> {
  const region = await resolveRegion(workspaceId, env)
  if (!region) {
    return errorResponse(404, "Workspace not found")
  }

  const config = getRegionConfig(region, regions)
  if (!config) {
    return errorResponse(502, "Region not configured")
  }

  return proxyRequest(request, config.apiUrl)
}

function routeToDefaultRegion(request: Request, regions: RegionsMap, env: Env): Response | Promise<Response> {
  if (!env.DEFAULT_REGION) {
    return errorResponse(404, "No default region configured")
  }

  const config = getRegionConfig(env.DEFAULT_REGION, regions)
  if (!config) {
    return errorResponse(502, "Default region not configured")
  }

  return proxyRequest(request, config.apiUrl)
}

async function proxyRequest(request: Request, targetBaseUrl: string): Promise<Response> {
  const url = new URL(request.url)
  const targetUrl = new URL(url.pathname + url.search, targetBaseUrl)

  const headers = new Headers(request.headers)
  headers.set("X-Forwarded-Host", url.host)
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""))
  headers.delete("host")

  return fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  })
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}
