import type { Pool } from "pg"
import {
  HttpError,
  isUniqueViolation,
  workspaceId as generateWorkspaceId,
  generateUniqueSlug,
  withTransaction,
  logger,
  displayNameFromWorkos,
  OutboxRepository,
  type WorkosOrgService,
} from "@threa/backend-common"
import { WorkspaceRegistryRepository } from "./repository"
import type { RegionalClient } from "../../lib/regional-client"
import type { KvClient } from "../../lib/cloudflare-kv-client"

export const OUTBOX_KV_SYNC = "kv_sync"

interface Dependencies {
  pool: Pool
  regionalClient: RegionalClient
  workosOrgService: WorkosOrgService
  kvClient: KvClient
  availableRegions: string[]
  requireWorkspaceCreationInvite: boolean
}

export class ControlPlaneWorkspaceService {
  private pool: Pool
  private regionalClient: RegionalClient
  private workosOrgService: WorkosOrgService
  private kvClient: KvClient
  private availableRegions: Set<string>
  private requireInvite: boolean

  constructor(deps: Dependencies) {
    this.pool = deps.pool
    this.regionalClient = deps.regionalClient
    this.workosOrgService = deps.workosOrgService
    this.kvClient = deps.kvClient
    this.availableRegions = new Set(deps.availableRegions)
    this.requireInvite = deps.requireWorkspaceCreationInvite
  }

  private defaultRegion(): string {
    const first = this.availableRegions.values().next().value
    if (!first) {
      throw new HttpError("No regions available", { status: 500, code: "NO_REGIONS" })
    }
    return first
  }

  listRegions(): string[] {
    return [...this.availableRegions]
  }

  async getRegion(workspaceId: string): Promise<string | null> {
    return WorkspaceRegistryRepository.getRegion(this.pool, workspaceId)
  }

  async listForUser(workosUserId: string) {
    const rows = await WorkspaceRegistryRepository.listByUser(this.pool, workosUserId)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      region: row.region,
      createdBy: row.created_by_workos_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async create(params: {
    name: string
    region?: string
    workosUserId: string
    authUser: { email: string; firstName?: string | null; lastName?: string | null }
  }) {
    const { name, workosUserId, authUser } = params
    const email = authUser.email
    const displayName = displayNameFromWorkos(authUser)

    const region = params.region ?? this.defaultRegion()
    if (!this.availableRegions.has(region)) {
      throw new HttpError(`Invalid region: ${region}`, { status: 400, code: "INVALID_REGION" })
    }

    if (this.requireInvite) {
      const hasInvite = await this.workosOrgService.hasAcceptedWorkspaceCreationInvitation(email)
      if (!hasInvite) {
        throw new HttpError("Workspace creation requires an accepted invitation", {
          status: 403,
          code: "INVITATION_REQUIRED",
        })
      }
    }

    const id = generateWorkspaceId()

    // Insert into control-plane DB with slug collision retry (INV-20).
    // generateUniqueSlug checks availability inside the transaction, but a concurrent
    // transaction can claim the same slug before COMMIT. The UNIQUE constraint catches
    // this — retry with a fresh slug check so the next attempt sees the committed slug.
    const MAX_SLUG_ATTEMPTS = 3
    let workspace: Awaited<ReturnType<typeof WorkspaceRegistryRepository.insert>>
    for (let attempt = 1; ; attempt++) {
      try {
        workspace = await withTransaction(this.pool, async (client) => {
          const slug = await generateUniqueSlug(name, (s) => WorkspaceRegistryRepository.slugExists(client, s))
          const ws = await WorkspaceRegistryRepository.insert(client, {
            id,
            name,
            slug,
            region,
            createdByWorkosUserId: workosUserId,
          })
          await WorkspaceRegistryRepository.insertMembership(client, id, workosUserId)

          // KV sync is async — the router falls back to the control-plane internal API
          await OutboxRepository.insert(client, OUTBOX_KV_SYNC, { workspaceId: id, region })

          return ws
        })
        break
      } catch (error) {
        if (attempt >= MAX_SLUG_ATTEMPTS || !isUniqueViolation(error, "workspace_registry_slug_key")) {
          throw error
        }
      }
    }

    // Regional provisioning must be synchronous — the user navigates to the workspace
    // immediately after creation and needs it to exist on the regional backend.
    try {
      await this.regionalClient.createWorkspace(region, {
        id,
        name: workspace.name,
        slug: workspace.slug,
        ownerWorkosUserId: workosUserId,
        ownerEmail: email,
        ownerName: displayName,
      })
    } catch (err) {
      logger.error({ err, workspaceId: id, region }, "Regional provisioning failed, cleaning up registry")
      try {
        await WorkspaceRegistryRepository.deleteMembershipsByWorkspace(this.pool, id)
        await WorkspaceRegistryRepository.deleteById(this.pool, id)
      } catch (cleanupErr) {
        logger.error({ cleanupErr, workspaceId: id }, "Registry cleanup also failed — orphaned entry")
      }
      throw new HttpError("Failed to provision workspace in region", { status: 502, code: "REGIONAL_ERROR" })
    }

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      region: workspace.region,
      createdBy: workspace.created_by_workos_user_id,
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
    }
  }

  /** Outbox handler: sync workspace-to-region mapping to Cloudflare KV */
  async syncToKv(payload: KvSyncPayload): Promise<void> {
    await this.kvClient.putWorkspaceRegion(payload.workspaceId, payload.region)
  }
}

export interface KvSyncPayload {
  workspaceId: string
  region: string
}
