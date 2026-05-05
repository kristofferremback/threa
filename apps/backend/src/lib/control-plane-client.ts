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
    region: string
    expiresAt: Date
    /** "email" → email-bound at creation; "link" → email-null until claim. */
    kind: "email" | "link"
    /** Required for kind="email", null for kind="link". */
    email: string | null
    /** Required for kind="link", null for kind="email". */
    tokenHash: string | null
    inviterWorkosUserId?: string
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

  /**
   * Notify CP that a previously unclaimed link invite has been bound to an
   * email. CP mirrors the email onto the shadow row and triggers the WorkOS
   * invitation so the recipient gets a verification email.
   */
  async notifyInvitationLinkClaimed(params: {
    id: string
    email: string
    inviterWorkosUserId?: string
  }): Promise<void> {
    const url = `${this.baseUrl}/internal/invitation-shadows/${params.id}/claim`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_API_KEY_HEADER]: this.internalApiKey,
      },
      body: JSON.stringify({
        email: params.email,
        ...(params.inviterWorkosUserId ? { inviterWorkosUserId: params.inviterWorkosUserId } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      logger.error({ id: params.id, status: res.status, body }, "Failed to notify invitation link claim")
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
