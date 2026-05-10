import { logger, INTERNAL_API_KEY_HEADER } from "@threa/backend-common"
import type { RegionConfig } from "../config"

const REGIONAL_REQUEST_TIMEOUT_MS = 15_000

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

  async createWorkspace(
    region: string,
    data: {
      id: string
      name: string
      slug: string
      ownerWorkosUserId: string
      ownerEmail: string
      ownerName: string
    }
  ): Promise<{ workspace: unknown }> {
    const url = `${this.getRegionUrl(region)}/internal/workspaces`
    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, region, url }, "Regional workspace creation request failed")
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ region, status: res.status, body }, "Regional workspace creation failed")
      throw new Error(`Regional backend returned ${res.status}: ${body}`)
    }

    return res.json()
  }

  async acceptInvitation(
    region: string,
    invitationId: string,
    data: { workosUserId: string; email: string; name: string }
  ): Promise<{ workspaceId: string }> {
    const url = `${this.getRegionUrl(region)}/internal/invitations/${invitationId}/accept`
    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, region, url, invitationId }, "Regional invitation acceptance request failed")
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ region, invitationId, status: res.status, body }, "Regional invitation acceptance failed")
      throw new Error(`Regional backend returned ${res.status}: ${body}`)
    }

    return res.json()
  }

  /**
   * Push a membership upsert to the regional `workspace_user_permissions`
   * mirror used by the API-key clamp path. Body matches the regional
   * `POST /internal/authz/memberships` discriminated-union schema.
   */
  async syncWorkspaceMembership(
    region: string,
    data: {
      workspaceId: string
      workosUserId: string
      roleSlugs: string[]
      status: string
      lastEventAt: Date
    }
  ): Promise<void> {
    const url = `${this.getRegionUrl(region)}/internal/authz/memberships`
    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify({
          kind: "upsert",
          workspaceId: data.workspaceId,
          workosUserId: data.workosUserId,
          roleSlugs: data.roleSlugs,
          status: data.status,
          lastEventAt: data.lastEventAt.toISOString(),
        }),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, region, url }, "Regional authz membership sync request failed")
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ region, status: res.status, body }, "Regional authz membership sync failed")
      throw new Error(`Regional backend returned ${res.status}: ${body}`)
    }
  }

  async removeWorkspaceMembership(
    region: string,
    data: { workspaceId: string; workosUserId: string; eventCreatedAt: Date }
  ): Promise<void> {
    const url = `${this.getRegionUrl(region)}/internal/authz/memberships`
    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify({
          kind: "remove",
          workspaceId: data.workspaceId,
          workosUserId: data.workosUserId,
          eventCreatedAt: data.eventCreatedAt.toISOString(),
        }),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, region, url }, "Regional authz membership removal request failed")
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ region, status: res.status, body }, "Regional authz membership removal failed")
      throw new Error(`Regional backend returned ${res.status}: ${body}`)
    }
  }

  /**
   * Forward a link-invitation claim from CP to the regional backend that owns
   * the row. Regional performs the atomic claim (INV-20). On 4xx, surfaces the
   * upstream error code so CP can map it to an HTTP status without parsing.
   */
  async claimInvitationLink(
    region: string,
    data: { token: string; email: string }
  ): Promise<{ ok: true; alreadyMember?: { workspaceId: string } }> {
    const url = `${this.getRegionUrl(region)}/internal/invitations/claim-link`
    let res: Response
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, region, url }, "Regional invitation link claim request failed")
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ region, status: res.status, body }, "Regional invitation link claim failed")
      throw new RegionalClaimError(res.status, body)
    }

    return res.json()
  }
}

export class RegionalClaimError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Regional backend returned ${status}: ${body}`)
    this.name = "RegionalClaimError"
  }

  /** Try to parse the upstream `code` from the JSON body. */
  upstreamCode(): string | null {
    try {
      const parsed = JSON.parse(this.body) as { code?: string }
      return typeof parsed.code === "string" ? parsed.code : null
    } catch {
      return null
    }
  }
}
