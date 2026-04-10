import { z } from "zod"
import type { Request, Response } from "express"
import { WorkspaceIntegrationService } from "./service"

const githubCallbackSchema = z.object({
  installation_id: z.string().min(1, "installation_id is required"),
  state: z.string().min(1, "state is required"),
})

interface Dependencies {
  workspaceIntegrationService: WorkspaceIntegrationService
  /**
   * Allowlist of frontend origins (e.g. CORS allowed origins) the GitHub install
   * callback is permitted to redirect to. Forwarded host headers that resolve to
   * an origin outside this list fall back to a relative redirect, which prevents
   * an attacker-controlled `x-forwarded-host` from turning the callback into an
   * open redirect if the backend is ever reached without going through the
   * trusted Cloudflare → control-plane proxy chain.
   */
  allowedFrontendOrigins: string[]
}

export function buildGithubCallbackRedirectUrl(
  req: Pick<Request, "headers" | "protocol">,
  workspaceId: string,
  allowedFrontendOrigins: string[]
): string {
  const path = `/w/${workspaceId}?ws-settings=integrations&provider=github`
  const forwardedHost = getFirstHeaderValue(req.headers["x-forwarded-host"])
  if (!forwardedHost) {
    return path
  }

  const forwardedProto = getFirstHeaderValue(req.headers["x-forwarded-proto"]) ?? req.protocol
  const forwardedPort = getFirstHeaderValue(req.headers["x-forwarded-port"])
  const origin = buildForwardedOrigin(forwardedProto, forwardedHost, forwardedPort)
  if (!origin || !allowedFrontendOrigins.includes(origin)) {
    return path
  }
  return `${origin}${path}`
}

export function createWorkspaceIntegrationHandlers({
  workspaceIntegrationService,
  allowedFrontendOrigins,
}: Dependencies) {
  return {
    async getGithub(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const integration = await workspaceIntegrationService.getGithubIntegration(workspaceId)
      res.json({
        configured: workspaceIntegrationService.isGitHubEnabled(),
        integration,
      })
    },

    async connectGithub(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const connectUrl = workspaceIntegrationService.getGithubConnectUrl(workspaceId)
      res.redirect(connectUrl)
    },

    async disconnectGithub(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      await workspaceIntegrationService.disconnectGithubIntegration(workspaceId)
      res.status(204).send()
    },

    async githubCallback(req: Request, res: Response) {
      const parsed = githubCallbackSchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(parsed.error).fieldErrors,
        })
      }

      const workosUserId = req.workosUserId!
      const { workspaceId } = await workspaceIntegrationService.handleGithubCallback({
        state: parsed.data.state,
        installationId: parsed.data.installation_id,
        workosUserId,
      })

      res.redirect(buildGithubCallbackRedirectUrl(req, workspaceId, allowedFrontendOrigins))
    },
  }
}

function getFirstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== "string") return null

  const first = raw
    .split(",")
    .map((part) => part.trim())
    .find(Boolean)

  return first ?? null
}

function buildForwardedOrigin(proto: string, host: string, port: string | null): string | null {
  try {
    const url = new URL(`${proto}://${host}`)
    if (port) {
      url.port = isDefaultPort(proto, port) ? "" : port
    }
    return url.origin
  } catch {
    return null
  }
}

function isDefaultPort(proto: string, port: string): boolean {
  return (proto === "http" && port === "80") || (proto === "https" && port === "443")
}
