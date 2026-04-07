import { z } from "zod"
import type { Request, Response } from "express"
import { WorkspaceIntegrationService } from "./service"

const githubCallbackSchema = z.object({
  installation_id: z.string().min(1, "installation_id is required"),
  state: z.string().min(1, "state is required"),
})

interface Dependencies {
  workspaceIntegrationService: WorkspaceIntegrationService
}

export function createWorkspaceIntegrationHandlers({ workspaceIntegrationService }: Dependencies) {
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

      res.redirect(`/w/${workspaceId}?ws-settings=integrations&provider=github`)
    },
  }
}
