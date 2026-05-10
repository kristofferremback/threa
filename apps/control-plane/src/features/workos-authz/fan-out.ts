import type { Pool } from "pg"
import { logger, type WorkosMembershipStatus } from "@threa/backend-common"
import { WorkspaceRegistryRepository } from "../workspaces"
import type { RegionalClient } from "../../lib/regional-client"

export const OUTBOX_AUTHZ_MEMBERSHIP_CHANGED = "authz_membership_changed"
export const OUTBOX_AUTHZ_MEMBERSHIP_REMOVED = "authz_membership_removed"

// `Record<string, unknown>` index signatures let these payloads flow through
// `OutboxRepository.insert`'s generic constraint without a cast at every call site.
export interface AuthzMembershipChangedPayload extends Record<string, unknown> {
  workosOrganizationId: string
  workosUserId: string
  roleSlugs: string[]
  status: WorkosMembershipStatus
  /** ISO timestamp; deserialized to Date by the dispatcher. */
  lastEventAt: string
}

export interface AuthzMembershipRemovedPayload extends Record<string, unknown> {
  workosOrganizationId: string
  workosUserId: string
  /** ISO timestamp; deserialized to Date by the dispatcher. */
  eventCreatedAt: string
}

interface Dependencies {
  pool: Pool
  regionalClient: RegionalClient
}

function parseIsoTimestamp(value: string, fieldName: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
  return parsed
}

export class RegionalAuthzFanOut {
  private pool: Pool
  private regionalClient: RegionalClient

  constructor({ pool, regionalClient }: Dependencies) {
    this.pool = pool
    this.regionalClient = regionalClient
  }

  async handleMembershipChanged(payload: AuthzMembershipChangedPayload): Promise<void> {
    const workspaces = await WorkspaceRegistryRepository.listByWorkosOrganizationId(
      this.pool,
      payload.workosOrganizationId
    )
    if (workspaces.length === 0) return

    const lastEventAt = parseIsoTimestamp(payload.lastEventAt, "lastEventAt")

    const results = await Promise.allSettled(
      workspaces.map((ws) =>
        this.regionalClient.syncWorkspaceMembership(ws.region, {
          workspaceId: ws.id,
          workosUserId: payload.workosUserId,
          roleSlugs: payload.roleSlugs,
          status: payload.status,
          lastEventAt,
        })
      )
    )

    const errors: unknown[] = []
    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        const ws = workspaces[idx]
        logger.error(
          { err: result.reason, region: ws.region, workspaceId: ws.id, workosUserId: payload.workosUserId },
          "Regional authz fan-out failed for workspace"
        )
        errors.push(result.reason)
      }
    })

    if (errors.length > 0) {
      throw new AggregateError(errors, "Regional authz fan-out failed for one or more workspaces")
    }
  }

  async handleMembershipRemoved(payload: AuthzMembershipRemovedPayload): Promise<void> {
    const workspaces = await WorkspaceRegistryRepository.listByWorkosOrganizationId(
      this.pool,
      payload.workosOrganizationId
    )
    if (workspaces.length === 0) return

    const eventCreatedAt = parseIsoTimestamp(payload.eventCreatedAt, "eventCreatedAt")

    const results = await Promise.allSettled(
      workspaces.map((ws) =>
        this.regionalClient.removeWorkspaceMembership(ws.region, {
          workspaceId: ws.id,
          workosUserId: payload.workosUserId,
          eventCreatedAt,
        })
      )
    )

    const errors: unknown[] = []
    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        const ws = workspaces[idx]
        logger.error(
          { err: result.reason, region: ws.region, workspaceId: ws.id, workosUserId: payload.workosUserId },
          "Regional authz removal fan-out failed for workspace"
        )
        errors.push(result.reason)
      }
    })

    if (errors.length > 0) {
      throw new AggregateError(errors, "Regional authz removal fan-out failed for one or more workspaces")
    }
  }
}
