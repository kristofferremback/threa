import { randomUUID } from "crypto"
import {
  withTransaction,
  OutboxRepository,
  logger,
  type WorkosEventSummary,
  type WorkosOrgService,
} from "@threa/backend-common"
import type { Pool } from "pg"
import { ControlPlaneAuthzMirrorRepository } from "./authz-mirror-repository"
import { WorkspaceRegistryRepository, type WorkspaceRegistryRow } from "./repository"
import type { RegionalClient } from "../../lib/regional-client"

export const OUTBOX_REGIONAL_AUTHZ_SYNC = "regional_authz_sync"

function getRoleSlugs(membership: { roles: Array<{ slug: string }>; role?: { slug: string } | null }): string[] {
  if (membership.roles.length > 0) return membership.roles.map((r) => r.slug)
  if (membership.role) return [membership.role.slug]
  return []
}

const EVENTS_SCOPE = "workos_authz_events"
const RECONCILE_SCOPE = "workos_authz_reconcile"
const LEASE_DURATION_MS = 30_000

const AUTHZ_EVENT_TYPES = [
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "organization_membership.created",
  "organization_membership.updated",
  "organization_membership.deleted",
  "organization_membership.added",
  "organization_membership.removed",
  "role.created",
  "role.updated",
  "role.deleted",
  "organization_role.created",
  "organization_role.updated",
  "organization_role.deleted",
]

const GLOBAL_ROLE_EVENT_TYPES = new Set([
  "role.created",
  "role.updated",
  "role.deleted",
  "organization_role.created",
  "organization_role.updated",
  "organization_role.deleted",
])

function extractOrganizationId(event: WorkosEventSummary): string | null {
  const data = event.data as Record<string, unknown>
  if (typeof data.organizationId === "string") return data.organizationId
  if (typeof data.organization_id === "string") return data.organization_id

  const organization = data.organization
  if (organization && typeof organization === "object") {
    const organizationRecord = organization as Record<string, unknown>
    if (typeof organizationRecord.id === "string") {
      return organizationRecord.id
    }
    if (typeof organizationRecord.organizationId === "string") {
      return organizationRecord.organizationId
    }
  }

  if (event.event.startsWith("organization.") && typeof data.id === "string") {
    return data.id
  }

  return null
}

interface Dependencies {
  pool: Pool
  workosOrgService: WorkosOrgService
  regionalClient: RegionalClient
}

export interface RegionalAuthzSyncPayload {
  workspaceId: string
  region: string
}

export class ControlPlaneAuthzSyncService {
  constructor(private deps: Dependencies) {}

  async pollEvents(): Promise<void> {
    const leaseOwner = `events_${randomUUID()}`
    const lease = await ControlPlaneAuthzMirrorRepository.tryAcquireLease(
      this.deps.pool,
      EVENTS_SCOPE,
      leaseOwner,
      new Date(Date.now() + LEASE_DURATION_MS)
    )
    if (!lease) {
      return
    }

    let cursor = lease.cursor
    try {
      const page = await this.deps.workosOrgService.listEvents({
        events: AUTHZ_EVENT_TYPES,
        after: cursor ?? undefined,
        limit: 100,
      })

      for (const event of page.data) {
        await this.processEvent(event)
        // WorkOS expects the `after` cursor to be the latest processed event ID.
        cursor = event.id
      }
    } finally {
      await ControlPlaneAuthzMirrorRepository.releaseLease(this.deps.pool, EVENTS_SCOPE, leaseOwner, cursor)
    }
  }

  async reconcileRegionalSnapshots(): Promise<void> {
    const leaseOwner = `reconcile_${randomUUID()}`
    const lease = await ControlPlaneAuthzMirrorRepository.tryAcquireLease(
      this.deps.pool,
      RECONCILE_SCOPE,
      leaseOwner,
      new Date(Date.now() + LEASE_DURATION_MS)
    )
    if (!lease) {
      return
    }

    try {
      const targets = await WorkspaceRegistryRepository.listAuthzSyncTargets(this.deps.pool)
      for (const target of targets) {
        if (!target.workos_organization_id) {
          continue
        }

        const snapshot = await ControlPlaneAuthzMirrorRepository.getSnapshot(this.deps.pool, target.id)
        if (!snapshot) {
          const workspace = await WorkspaceRegistryRepository.findById(this.deps.pool, target.id)
          if (workspace?.workos_organization_id) {
            await this.refreshWorkspaceFromWorkos(workspace)
          }
          continue
        }

        await this.enqueueRegionalSync(target.id, target.region)
      }
    } finally {
      await ControlPlaneAuthzMirrorRepository.releaseLease(this.deps.pool, RECONCILE_SCOPE, leaseOwner, null)
    }
  }

  async dispatchRegionalSync(payload: RegionalAuthzSyncPayload): Promise<void> {
    const snapshot = await ControlPlaneAuthzMirrorRepository.getSnapshot(this.deps.pool, payload.workspaceId)
    if (!snapshot) {
      throw new Error(`Missing canonical authz snapshot for workspace ${payload.workspaceId}`)
    }

    await this.deps.regionalClient.applyWorkspaceAuthzSnapshot(payload.region, payload.workspaceId, snapshot)
  }

  private async processEvent(event: WorkosEventSummary): Promise<void> {
    if (await ControlPlaneAuthzMirrorRepository.hasRecordedEvent(this.deps.pool, event.id)) {
      return
    }

    const organizationId = extractOrganizationId(event)

    if (!organizationId && GLOBAL_ROLE_EVENT_TYPES.has(event.event)) {
      const targets = await WorkspaceRegistryRepository.listAuthzSyncTargets(this.deps.pool)
      for (const target of targets) {
        if (!target.workos_organization_id) {
          continue
        }
        const workspace = await WorkspaceRegistryRepository.findById(this.deps.pool, target.id)
        if (workspace?.workos_organization_id) {
          await this.refreshWorkspaceFromWorkos(workspace)
        }
      }

      await ControlPlaneAuthzMirrorRepository.recordEvent(this.deps.pool, {
        eventId: event.id,
        eventType: event.event,
        organizationId: null,
        workspaceId: null,
        status: "processed",
        occurredAt: event.createdAt,
        payload: event.data,
      })
      return
    }

    if (!organizationId) {
      await ControlPlaneAuthzMirrorRepository.recordEvent(this.deps.pool, {
        eventId: event.id,
        eventType: event.event,
        organizationId: null,
        workspaceId: null,
        status: "skipped_missing_org",
        occurredAt: event.createdAt,
        payload: event.data,
      })
      return
    }

    const workspace = await WorkspaceRegistryRepository.findByWorkosOrganizationId(this.deps.pool, organizationId)
    if (!workspace) {
      await ControlPlaneAuthzMirrorRepository.recordEvent(this.deps.pool, {
        eventId: event.id,
        eventType: event.event,
        organizationId,
        workspaceId: null,
        status: "skipped_unknown_org",
        occurredAt: event.createdAt,
        payload: event.data,
      })
      return
    }

    if (event.event === "organization.deleted") {
      await this.replaceCanonicalSnapshot(workspace, [])
    } else {
      await this.refreshWorkspaceFromWorkos(workspace)
    }

    await ControlPlaneAuthzMirrorRepository.recordEvent(this.deps.pool, {
      eventId: event.id,
      eventType: event.event,
      organizationId,
      workspaceId: workspace.id,
      status: "processed",
      occurredAt: event.createdAt,
      payload: event.data,
    })
  }

  private async refreshWorkspaceFromWorkos(workspace: WorkspaceRegistryRow): Promise<void> {
    if (!workspace.workos_organization_id) {
      return
    }

    const [roles, memberships] = await Promise.all([
      this.deps.workosOrgService.listRolesForOrganization(workspace.workos_organization_id),
      this.deps.workosOrgService.listOrganizationMemberships(workspace.workos_organization_id),
    ])

    await this.replaceCanonicalSnapshot(
      workspace,
      memberships
        .filter((membership) => membership.status === "active")
        .map((membership) => ({
          organizationMembershipId: membership.id,
          workosUserId: membership.userId,
          roleSlugs: getRoleSlugs(membership),
        })),
      roles
    )
  }

  private async replaceCanonicalSnapshot(
    workspace: WorkspaceRegistryRow,
    memberships: Array<{
      organizationMembershipId: string
      workosUserId: string
      roleSlugs: string[]
    }>,
    roles: Awaited<ReturnType<WorkosOrgService["listRolesForOrganization"]>> = []
  ): Promise<void> {
    if (!workspace.workos_organization_id) {
      return
    }

    await withTransaction(this.deps.pool, async (client) => {
      await ControlPlaneAuthzMirrorRepository.replaceSnapshot(client, {
        workspaceId: workspace.id,
        workosOrganizationId: workspace.workos_organization_id!,
        roles,
        memberships,
      })
      await OutboxRepository.insert(client, OUTBOX_REGIONAL_AUTHZ_SYNC, {
        workspaceId: workspace.id,
        region: workspace.region,
      })
    })
  }

  private async enqueueRegionalSync(workspaceId: string, region: string): Promise<void> {
    await withTransaction(this.deps.pool, async (client) => {
      await OutboxRepository.insert(client, OUTBOX_REGIONAL_AUTHZ_SYNC, {
        workspaceId,
        region,
      })
    })
  }
}
