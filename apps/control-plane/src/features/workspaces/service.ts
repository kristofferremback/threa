import type { Pool } from "pg"
import {
  HttpError,
  workspaceId as generateWorkspaceId,
  generateUniqueSlug,
  withTransaction,
  logger,
  type WorkosOrgService,
} from "@threa/backend-common"
import { WorkspaceRegistryRepository } from "./repository"
import type { RegionalClient } from "../../lib/regional-client"
import type { CloudflareKvClient } from "../../lib/cloudflare-kv-client"

interface Dependencies {
  pool: Pool
  regionalClient: RegionalClient
  kvClient: CloudflareKvClient | null
  workosOrgService: WorkosOrgService
  availableRegions: string[]
  requireWorkspaceCreationInvite: boolean
}

export class ControlPlaneWorkspaceService {
  private pool: Pool
  private regionalClient: RegionalClient
  private kvClient: CloudflareKvClient | null
  private workosOrgService: WorkosOrgService
  private availableRegions: Set<string>
  private requireInvite: boolean

  constructor(deps: Dependencies) {
    this.pool = deps.pool
    this.regionalClient = deps.regionalClient
    this.kvClient = deps.kvClient
    this.workosOrgService = deps.workosOrgService
    this.availableRegions = new Set(deps.availableRegions)
    this.requireInvite = deps.requireWorkspaceCreationInvite
  }

  async listForUser(workosUserId: string) {
    const rows = await WorkspaceRegistryRepository.listByUser(this.pool, workosUserId)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      region: row.region,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async create(params: { name: string; region: string; workosUserId: string; email: string; displayName: string }) {
    const { name, region, workosUserId, email, displayName } = params

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

    // Insert into control-plane DB (slug generated inside transaction per INV-20)
    const workspace = await withTransaction(this.pool, async (client) => {
      const slug = await generateUniqueSlug(name, (s) => WorkspaceRegistryRepository.slugExists(client, s))
      const ws = await WorkspaceRegistryRepository.insert(client, {
        id,
        name,
        slug,
        region,
        createdByWorkosUserId: workosUserId,
      })
      await WorkspaceRegistryRepository.insertMembership(client, id, workosUserId)
      return ws
    })

    // Create in regional backend
    try {
      await this.regionalClient.createWorkspace(region, {
        id,
        name,
        slug: workspace.slug,
        ownerWorkosUserId: workosUserId,
        ownerEmail: email,
        ownerName: displayName,
      })
    } catch (error) {
      // Compensating transaction: delete from control-plane DB
      logger.error({ err: error, workspaceId: id, region }, "Regional workspace creation failed, rolling back")
      await WorkspaceRegistryRepository.deleteMembershipsByWorkspace(this.pool, id)
      await WorkspaceRegistryRepository.deleteById(this.pool, id)
      throw new HttpError("Failed to create workspace in regional backend", { status: 502, code: "REGIONAL_FAILURE" })
    }

    // Write to Cloudflare KV (best-effort)
    if (this.kvClient) {
      try {
        await this.kvClient.putWorkspaceRegion(id, region)
      } catch (error) {
        logger.error({ err: error, workspaceId: id, region }, "Failed to write workspace-to-region KV mapping")
        // Non-fatal: router can fall back to other resolution
      }
    }

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      region: workspace.region,
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
    }
  }
}
