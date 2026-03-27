import { INTERNAL_API_KEY_HEADER } from "@threa/types"

interface Env {
  WORKSPACE_REGIONS: KVNamespace
  /** JSON map of region name → { apiUrl, wsUrl } */
  REGIONS: string
  /** Base URL for the control-plane service (handles auth, workspace list/create) */
  CONTROL_PLANE_URL?: string
  /** Shared secret for control-plane internal API */
  INTERNAL_API_KEY?: string
  /** When "true", resolve regions from KV before falling back to env var (staging only) */
  USE_KV_REGIONS?: string
  /** CF Pages project name for frontend proxying (staging only, e.g. "threa-staging") */
  PAGES_PROJECT?: string
  /** The staging base domain (e.g. "staging.threa.io") — used to extract PR subdomain */
  STAGING_DOMAIN?: string
  /** Staging WS domain (e.g. "ws-staging.threa.io") — enables hostname-based WS routing */
  WS_STAGING_DOMAIN?: string
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

/** Resolve regions map: prefer KV-stored config (staging only), fall back to env var */
async function getRegions(envRegions: string, kv: KVNamespace, useKv: boolean): Promise<RegionsMap> {
  if (useKv) {
    const kvRegions = await kv.get(REGIONS_CONFIG_KV_KEY)
    if (kvRegions) return parseRegions(kvRegions)
  }
  return getRegionsFromEnv(envRegions)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const regions = await getRegions(env.REGIONS, env.WORKSPACE_REGIONS, env.USE_KV_REGIONS === "true")
    const url = new URL(request.url)
    const path = url.pathname

    // Router health check (handled locally, not proxied)
    if (path === "/readyz" && request.method === "GET") {
      return new Response("OK", { status: 200 })
    }

    // Staging WS routing: ws-staging.threa.io → proxy to region backend
    // Region is passed as a ?region= query param (set by the config endpoint's wsUrl)
    if (env.WS_STAGING_DOMAIN && url.hostname === env.WS_STAGING_DOMAIN) {
      const regionName = url.searchParams.get("region") || Object.keys(regions)[0]
      const config = regionName ? getRegionConfig(regionName, regions) : null
      if (!config) return errorResponse(404, "Unknown staging region")
      return proxyRequest(request, config.apiUrl)
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

    // Non-API routes: proxy to CF Pages frontend (staging only)
    if (env.PAGES_PROJECT && env.STAGING_DOMAIN) {
      return proxyToPages(request, env.PAGES_PROJECT, env.STAGING_DOMAIN)
    }

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

  // In staging, construct the wsUrl with region as a query param
  const wsUrl = env.WS_STAGING_DOMAIN ? `https://${env.WS_STAGING_DOMAIN}?region=${region}` : config.wsUrl
  return Response.json({ region, wsUrl })
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

/**
 * Proxy non-API requests to the CF Pages frontend deployment.
 * Maps hostnames to Pages URLs:
 *   staging.threa.io        → threa-staging.pages.dev
 *   pr-123.staging.threa.io → pr-123.threa-staging.pages.dev
 */
async function proxyToPages(request: Request, pagesProject: string, stagingDomain: string): Promise<Response> {
  const url = new URL(request.url)
  const hostname = url.hostname

  // Extract PR subdomain: "pr-123.staging.threa.io" → "pr-123"
  let pagesHost = `${pagesProject}.pages.dev`
  if (hostname !== stagingDomain) {
    const suffix = `.${stagingDomain}`
    if (hostname.endsWith(suffix)) {
      const subdomain = hostname.slice(0, -suffix.length)
      pagesHost = `${subdomain}.${pagesProject}.pages.dev`
    }
  }

  const pagesUrl = new URL(url.pathname + url.search, `https://${pagesHost}`)
  const response = await fetch(pagesUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
  })

  // Return the response with original headers (CF Pages handles caching/content-type)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}
