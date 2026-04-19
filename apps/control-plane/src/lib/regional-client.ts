import { logger, INTERNAL_API_KEY_HEADER } from "@threa/backend-common"
import type { RegionConfig } from "../config"

const REGIONAL_REQUEST_TIMEOUT_MS = 15_000

type Jsonable = Record<string, unknown>

export class RegionalClient {
  constructor(
    private regions: Record<string, RegionConfig>,
    private internalApiKey: string
  ) {}

  private getRegionUrl(region: string): string {
    const config = this.regions[region]
    if (!config) {
      throw new Error(`Unknown region: ${region}`)
    }
    return config.internalUrl
  }

  /**
   * Shared wiring for every internal POST/PUT to a regional backend:
   * shared-secret header, configured timeout, consistent error logging. The
   * `operation` string appears in log entries and thrown messages so on-call
   * can trace which call path hit the failure.
   */
  private async internalRequest(params: {
    region: string
    method: "POST" | "PUT"
    path: string
    body: Jsonable
    operation: string
    extraLogContext?: Record<string, unknown>
  }): Promise<Response> {
    const url = `${this.getRegionUrl(params.region)}${params.path}`
    const baseLog = { region: params.region, url, ...params.extraLogContext }
    let res: Response
    try {
      res = await fetch(url, {
        method: params.method,
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify(params.body),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, ...baseLog }, `Regional ${params.operation} request failed`)
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ ...baseLog, status: res.status, body }, `Regional ${params.operation} failed`)
      throw new Error(`Regional backend returned ${res.status}: ${body}`)
    }

    return res
  }

  async createWorkspace(
    region: string,
    data: {
      id: string
      name: string
      slug: string
      ownerWorkosUserId: string
      ownerEmail: string
      ownerName: string
      isPlatformAdmin?: boolean
    }
  ): Promise<{ workspace: unknown }> {
    const res = await this.internalRequest({
      region,
      method: "POST",
      path: "/internal/workspaces",
      body: data,
      operation: "workspace creation",
    })
    return res.json()
  }

  async acceptInvitation(
    region: string,
    invitationId: string,
    data: { workosUserId: string; email: string; name: string; isPlatformAdmin?: boolean }
  ): Promise<{ workspaceId: string }> {
    const res = await this.internalRequest({
      region,
      method: "POST",
      path: `/internal/invitations/${invitationId}/accept`,
      body: data,
      operation: "invitation acceptance",
      extraLogContext: { invitationId },
    })
    return res.json()
  }

  /**
   * Upsert or revoke a user's platform-admin flag on a regional backend. Used
   * by the boot-time reconcile sweep and by future platform-role mutations so
   * regional backends can gate the control-panel link without a cross-service
   * call per session.
   */
  async setPlatformAdmin(region: string, workosUserId: string, isAdmin: boolean): Promise<void> {
    await this.internalRequest({
      region,
      method: "PUT",
      path: `/internal/platform-admins/${encodeURIComponent(workosUserId)}`,
      body: { isAdmin },
      operation: "setPlatformAdmin",
      extraLogContext: { workosUserId },
    })
  }
}
