import type { Request, Response } from "express"
import { extractWorkspaceIdFromGithubInstallState } from "@threa/backend-common"
import type { RegionConfig } from "../../config"
import type { ControlPlaneWorkspaceService } from "../workspaces"

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

interface Dependencies {
  workspaceService: ControlPlaneWorkspaceService
  regions: Record<string, RegionConfig>
}

export function createIntegrationHandlers({ workspaceService, regions }: Dependencies) {
  return {
    async githubCallback(req: Request, res: Response) {
      const rawState = req.query.state
      const state = typeof rawState === "string" ? rawState : null
      const workspaceId = state ? extractWorkspaceIdFromGithubInstallState(state) : null
      if (!workspaceId) {
        return res.status(400).json({ error: "Missing or invalid state parameter" })
      }

      const region = await workspaceService.getRegion(workspaceId)
      if (!region) {
        return res.status(404).json({ error: "Workspace not found" })
      }

      const target = regions[region]
      if (!target) {
        return res.status(502).json({ error: "Workspace region is not configured" })
      }

      const proxyResponse = await fetch(new URL(req.originalUrl, target.internalUrl), {
        method: req.method,
        headers: forwardHeaders(req),
      })

      res.status(proxyResponse.status)
      proxyResponse.headers.forEach((value, key) => {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
          res.setHeader(key, value)
        }
      })

      const body = Buffer.from(await proxyResponse.arrayBuffer())
      res.send(body)
    },
  }
}

function forwardHeaders(req: Request): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue
    headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }

  headers.set("x-forwarded-host", req.get("x-forwarded-host") ?? req.get("host") ?? "")
  headers.set("x-forwarded-proto", req.get("x-forwarded-proto") ?? req.protocol)
  return headers
}
