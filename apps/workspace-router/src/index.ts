import { INTERNAL_API_KEY_HEADER } from "@threa/types"

interface Env {
  WORKSPACE_REGIONS: KVNamespace
  /** JSON map of region name → { apiUrl, wsUrl } */
  REGIONS: string
  /** Base URL for the control-plane service (handles auth, workspace list/create) */
  CONTROL_PLANE_URL?: string
  /** Shared secret for control-plane internal API */
  INTERNAL_API_KEY?: string
}

interface RegionConfig {
  apiUrl: string
  wsUrl: string
}

type RegionsMap = Record<string, RegionConfig>

/** Routes that should go to the control-plane (auth, workspace collection, regions) */
const AUTH_ROUTE_RE = /^\/api\/auth\//
const WORKSPACES_COLLECTION_RE = /^\/api\/workspaces\/?$/
const REGIONS_ROUTE_RE = /^\/api\/regions\/?$/
/** Dev auth routes that the control-plane handles in stub mode */
const DEV_AUTH_ROUTE_RE = /^\/(?:test-auth-login|api\/dev\/login)\/?$/
/** User-facing invitation acceptance (handled by control-plane) */
const INVITATION_ACCEPT_RE = /^\/api\/invitations\/[^/]+\/accept$/

/** Matches /api/workspaces/:workspaceId with optional trailing path */
const WORKSPACE_ROUTE_RE = /^\/api\/workspaces\/([^/]+)(?:\/.+)?$/
/** Public API v1 routes — routed to regional backend like workspace routes */
const PUBLIC_API_ROUTE_RE = /^\/api\/v1\/workspaces\/([^/]+)(?:\/.+)?$/
/** Dev workspace routes (workspace/stream join — test only) */
const DEV_WORKSPACE_ROUTE_RE = /^\/api\/dev\/workspaces\/([^/]+)(?:\/.+)?$/

/** Matches /api/workspaces/:workspaceId/config exactly */
const CONFIG_ROUTE_RE = /^\/api\/workspaces\/([^/]+)\/config$/

/** KV key for dynamic regions config (used by staging CI to register PR backends) */
const REGIONS_CONFIG_KV_KEY = "__regions_config__"

/** Cache parsed regions per REGIONS string (static per env binding) */
let cachedRegionsRaw: string | null = null
let cachedRegions: RegionsMap | null = null

function getRegionsFromEnv(raw: string): RegionsMap {
  if (raw === cachedRegionsRaw && cachedRegions) return cachedRegions
  cachedRegions = parseRegions(raw)
  cachedRegionsRaw = raw
  return cachedRegions
}

/** Resolve regions map: prefer KV-stored config (for staging), fall back to env var */
async function getRegions(envRegions: string, kv: KVNamespace): Promise<RegionsMap> {
  const kvRegions = await kv.get(REGIONS_CONFIG_KV_KEY)
  if (kvRegions) return parseRegions(kvRegions)
  return getRegionsFromEnv(envRegions)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const regions = await getRegions(env.REGIONS, env.WORKSPACE_REGIONS)
    const url = new URL(request.url)
    const path = url.pathname

    // Router health check (handled locally, not proxied)
    if (path === "/readyz" && request.method === "GET") {
      return new Response("OK", { status: 200 })
    }

    // Control-plane routes (auth, workspace list/create, regions, dev auth)
    if (env.CONTROL_PLANE_URL) {
      const method = request.method
      if (
        AUTH_ROUTE_RE.test(path) ||
        (WORKSPACES_COLLECTION_RE.test(path) && (method === "GET" || method === "POST")) ||
        REGIONS_ROUTE_RE.test(path) ||
        DEV_AUTH_ROUTE_RE.test(path) ||
        (INVITATION_ACCEPT_RE.test(path) && method === "POST")
      ) {
        try {
          return await proxyRequest(request, env.CONTROL_PLANE_URL)
        } catch {
          return errorResponse(502, "Control plane unavailable")
        }
      }
    }

    // Config endpoint: returns the direct WebSocket URL for a workspace
    const configMatch = path.match(CONFIG_ROUTE_RE)
    if (configMatch && request.method === "GET") {
      return handleConfigRequest(configMatch[1], regions, env)
    }

    // Public API v1 routes (API key auth, routed to regional backend)
    const publicApiMatch = path.match(PUBLIC_API_ROUTE_RE)
    if (publicApiMatch) {
      return routeWorkspaceRequest(request, publicApiMatch[1], regions, env)
    }

    // Workspace-scoped API routes
    const workspaceMatch = path.match(WORKSPACE_ROUTE_RE)
    if (workspaceMatch) {
      return routeWorkspaceRequest(request, workspaceMatch[1], regions, env)
    }

    // Dev workspace routes (e.g. /api/dev/workspaces/:id/join) — test only
    const devWorkspaceMatch = path.match(DEV_WORKSPACE_ROUTE_RE)
    if (devWorkspaceMatch) {
      return routeWorkspaceRequest(request, devWorkspaceMatch[1], regions, env)
    }

    // All meaningful non-workspace routes are handled above (control-plane, config).
    // Anything else is an unrecognized path.
    return errorResponse(404, "Not found")
  },
}

function parseRegions(raw: string): RegionsMap {
  if (!raw) throw new Error("REGIONS env var is empty or missing")
  try {
    return JSON.parse(raw) as RegionsMap
  } catch (e) {
    throw new Error(`REGIONS env var is not valid JSON: ${(e as Error).message}`)
  }
}

async function resolveRegion(workspaceId: string, env: Env): Promise<string | null> {
  // Fast path: KV cache hit
  const cached = await env.WORKSPACE_REGIONS.get(workspaceId)
  if (cached) return cached

  // Slow path: ask the control-plane (source of truth) and cache the result
  if (!env.CONTROL_PLANE_URL || !env.INTERNAL_API_KEY) return null

  const res = await fetch(`${env.CONTROL_PLANE_URL}/internal/workspaces/${workspaceId}/region`, {
    headers: { [INTERNAL_API_KEY_HEADER]: env.INTERNAL_API_KEY },
  })
  if (!res.ok) return null

  const { region } = (await res.json()) as { region: string }
  // Cache in KV so subsequent requests are fast
  await env.WORKSPACE_REGIONS.put(workspaceId, region)
  return region
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

async function proxyRequest(request: Request, targetBaseUrl: string): Promise<Response> {
  const url = new URL(request.url)
  const targetUrl = new URL(url.pathname + url.search, targetBaseUrl)

  const headers = new Headers(request.headers)
  headers.set("X-Forwarded-Host", url.host)
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""))

  // Only trust CF-Connecting-IP (set by Cloudflare, not spoofable by clients).
  // Strip any client-supplied X-Forwarded-For to prevent rate limit bypass.
  const clientIp = request.headers.get("CF-Connecting-IP")
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp)
  } else {
    headers.delete("X-Forwarded-For")
  }

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
