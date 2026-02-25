import { logger } from "./logger"
import { INTERNAL_API_KEY_HEADER } from "@threa/backend-common"

const REQUEST_TIMEOUT_MS = 10_000

export class ControlPlaneClient {
  constructor(
    private baseUrl: string,
    private internalApiKey: string
  ) {}

  async createInvitationShadow(params: {
    id: string
    workspaceId: string
    email: string
    region: string
    expiresAt: Date
  }): Promise<void> {
    const url = `${this.baseUrl}/internal/invitation-shadows`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
      },
      body: JSON.stringify({
        ...params,
        expiresAt: params.expiresAt.toISOString(),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ status: res.status, body }, "Failed to create invitation shadow")
      throw new Error(`Control-plane returned ${res.status}: ${body}`)
    }
  }

  async revokeInvitationShadow(id: string): Promise<void> {
    const url = `${this.baseUrl}/internal/invitation-shadows/${id}`
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
      },
      body: JSON.stringify({ status: "revoked" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ id, status: res.status, body }, "Failed to revoke invitation shadow")
      throw new Error(`Control-plane returned ${res.status}: ${body}`)
    }
  }
}
