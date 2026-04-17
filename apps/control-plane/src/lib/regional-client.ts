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
      isPlatformAdmin?: boolean
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
    data: { workosUserId: string; email: string; name: string; isPlatformAdmin?: boolean }
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
   * Upsert or revoke a user's platform-admin flag on a regional backend. Used
   * by the boot-time reconcile sweep and by future platform-role mutations so
   * regional backends can gate the control-panel link without a cross-service
   * call per session.
   */
  async setPlatformAdmin(region: string, workosUserId: string, isAdmin: boolean): Promise<void> {
    const url = `${this.getRegionUrl(region)}/internal/platform-admins/${encodeURIComponent(workosUserId)}`
    let res: Response
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
        },
        body: JSON.stringify({ isAdmin }),
        signal: AbortSignal.timeout(REGIONAL_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      logger.error({ err, region, url, workosUserId }, "Regional setPlatformAdmin request failed")
      throw err
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ region, workosUserId, status: res.status, body }, "Regional setPlatformAdmin failed")
      throw new Error(`Regional backend returned ${res.status}: ${body}`)
    }
  }
}
