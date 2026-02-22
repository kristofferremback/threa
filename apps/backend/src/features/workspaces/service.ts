import { Pool } from "pg"
import { withTransaction, withClient, type Querier } from "../../db"
import { WorkspaceRepository, Workspace, WorkspaceUser } from "./repository"
import { UserRepository } from "./member-repository"
import { OutboxRepository } from "../../lib/outbox"
import { StreamRepository, StreamMemberRepository } from "../streams"
import { EmojiUsageRepository } from "../emoji"
import { PersonaRepository, type Persona } from "../agents"
import { workspaceId, memberId as generateMemberId, streamId, avatarUploadId } from "../../lib/id"
import { generateSlug, generateUniqueSlug } from "../../lib/slug"
import { serializeBigInt } from "../../lib/serialization"
import { HttpError, isUniqueViolation } from "../../lib/errors"
import { JobQueues } from "../../lib/queue"
import type { QueueManager } from "../../lib/queue"
import type { WorkosOrgService } from "../../auth/workos-org-service"
import { AvatarUploadRepository } from "./avatar-upload-repository"
import type { AvatarService } from "./avatar-service"

function deriveSlugFromEmail(email: string): string {
  const prefix = email.split("@")[0]
  return generateSlug(prefix)
}

export interface CreateWorkspaceParams {
  name: string
  workosUserId: string
  email: string
  userName: string
  setupCompleted?: boolean
}

export class WorkspaceService {
  private pool: Pool
  private workosOrgService: WorkosOrgService | null
  private avatarService: AvatarService
  private jobQueue: QueueManager

  constructor(pool: Pool, avatarService: AvatarService, jobQueue: QueueManager, workosOrgService?: WorkosOrgService) {
    this.pool = pool
    this.avatarService = avatarService
    this.jobQueue = jobQueue
    this.workosOrgService = workosOrgService ?? null
  }

  async getWorkspaceById(id: string): Promise<Workspace | null> {
    return WorkspaceRepository.findById(this.pool, id)
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return WorkspaceRepository.findBySlug(this.pool, slug)
  }

  async getWorkspacesByWorkosUserId(workosUserId: string): Promise<Workspace[]> {
    return WorkspaceRepository.list(this.pool, { workosUserId })
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    return withTransaction(this.pool, async (client) => {
      const id = workspaceId()
      const ownerUserId = generateMemberId()
      const slug = await generateUniqueSlug(params.name, (slug) => WorkspaceRepository.slugExists(client, slug))

      const ws = await WorkspaceRepository.insert(client, {
        id,
        name: params.name,
        slug,
        createdBy: ownerUserId,
      })

      await this.createUserInTransaction(client, {
        id: ownerUserId,
        workspaceId: id,
        workosUserId: params.workosUserId,
        email: params.email,
        name: params.userName,
        role: "owner",
        setupCompleted: params.setupCompleted,
      })

      return ws
    })
  }

  async addUser(
    wsId: string,
    params: {
      workosUserId: string
      email: string
      name: string
      role?: WorkspaceUser["role"]
      setupCompleted?: boolean
    }
  ): Promise<WorkspaceUser> {
    return withTransaction(this.pool, async (client) => {
      return this.createUserInTransaction(client, {
        workspaceId: wsId,
        workosUserId: params.workosUserId,
        email: params.email,
        name: params.name,
        role: params.role ?? "member",
        setupCompleted: params.setupCompleted,
      })
    })
  }

  async createUserInTransaction(
    client: Querier,
    params: {
      id?: string
      workspaceId: string
      workosUserId: string
      email: string
      name: string
      role: WorkspaceUser["role"]
      setupCompleted?: boolean
    }
  ): Promise<WorkspaceUser> {
    const normalizedEmail = params.email.trim().toLowerCase()
    const userSlug = await generateUniqueSlug(params.name, (s) =>
      WorkspaceRepository.userSlugExists(client, params.workspaceId, s)
    )

    const user = await WorkspaceRepository.addUser(client, {
      id: params.id ?? generateMemberId(),
      workspaceId: params.workspaceId,
      workosUserId: params.workosUserId,
      email: normalizedEmail,
      slug: userSlug,
      name: params.name,
      role: params.role,
      setupCompleted: params.setupCompleted,
    })

    const fullUser = await UserRepository.findById(client, user.id)
    if (fullUser) {
      await OutboxRepository.insert(client, "workspace_member:added", {
        workspaceId: params.workspaceId,
        member: serializeBigInt(fullUser),
      })
    }

    const sId = streamId()
    const stream = await StreamRepository.insertSystemStream(client, {
      id: sId,
      workspaceId: params.workspaceId,
      createdBy: user.id,
    })
    await StreamMemberRepository.insert(client, sId, user.id)
    await OutboxRepository.insert(client, "stream:created", {
      workspaceId: params.workspaceId,
      streamId: sId,
      stream,
    })

    return user
  }

  async removeUser(workspaceId: string, userId: string): Promise<void> {
    return withTransaction(this.pool, async (client) => {
      await WorkspaceRepository.removeUserById(client, workspaceId, userId)

      await OutboxRepository.insert(client, "workspace_member:removed", {
        workspaceId,
        memberId: userId,
      })
    })
  }

  async getUsers(workspaceId: string): Promise<WorkspaceUser[]> {
    return WorkspaceRepository.listUsers(this.pool, workspaceId)
  }

  async isMember(workspaceId: string, workosUserId: string): Promise<boolean> {
    return WorkspaceRepository.isMember(this.pool, workspaceId, workosUserId)
  }

  async getPersonasForWorkspace(workspaceId: string): Promise<Persona[]> {
    return PersonaRepository.listForWorkspace(this.pool, workspaceId)
  }

  async getEmojiWeights(workspaceId: string, memberId: string): Promise<Record<string, number>> {
    return EmojiUsageRepository.getWeights(this.pool, workspaceId, memberId)
  }

  async isSlugAvailable(workspaceId: string, slug: string): Promise<boolean> {
    const exists = await WorkspaceRepository.userSlugExists(this.pool, workspaceId, slug)
    return !exists
  }

  async completeUserSetup(
    userId: string,
    workspaceId: string,
    params: { name?: string; slug?: string; timezone: string; locale: string }
  ): Promise<WorkspaceUser> {
    // Phase 1: Fast reads
    const { user, orgId } = await withClient(this.pool, async (client) => {
      const user = await UserRepository.findById(client, userId)
      if (!user || user.workspaceId !== workspaceId) {
        throw new HttpError("Member not found", { status: 404, code: "MEMBER_NOT_FOUND" })
      }

      if (user.setupCompleted) {
        throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
      }

      const orgId = await WorkspaceRepository.getWorkosOrganizationId(client, workspaceId)
      return { user, orgId }
    })

    // Phase 2: External API call — no DB connection held
    const preferEmailSlug = await this.shouldPreferEmailSlug(orgId, user.email)

    // Phase 3: Transaction with retry on slug collision.
    // generateUniqueSlug checks availability within the transaction, but a concurrent
    // transaction can claim the same slug before our COMMIT. The UNIQUE constraint
    // catches this — retry with a fresh check so the next attempt sees the committed slug.
    const MAX_SLUG_ATTEMPTS = 3
    for (let attempt = 1; ; attempt++) {
      try {
        return await withTransaction(this.pool, async (client) => {
          // Re-read user inside transaction to get fresh slug (Phase 1 value may be stale)
          const currentUser = await UserRepository.findById(client, userId)
          if (!currentUser || currentUser.setupCompleted) {
            throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
          }

          let slug: string

          if (preferEmailSlug) {
            slug = deriveSlugFromEmail(user.email)
          } else if (params.slug) {
            slug = generateSlug(params.slug)
          } else {
            slug = await generateUniqueSlug(user.name, (s) =>
              WorkspaceRepository.userSlugExists(client, workspaceId, s)
            )
          }

          const slugExists = await WorkspaceRepository.userSlugExists(client, workspaceId, slug)
          if (slugExists && slug !== currentUser.slug) {
            slug = await generateUniqueSlug(slug, (s) => WorkspaceRepository.userSlugExists(client, workspaceId, s))
          }

          const updated = await WorkspaceRepository.updateUser(client, userId, {
            slug,
            name: params.name,
            timezone: params.timezone,
            locale: params.locale,
            setupCompleted: true,
          })

          if (!updated) {
            throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
          }

          const fullUser = await UserRepository.findById(client, userId)
          if (fullUser) {
            await OutboxRepository.insert(client, "member:updated", {
              workspaceId,
              member: serializeBigInt(fullUser),
            })
          }

          return updated
        })
      } catch (error) {
        if (attempt >= MAX_SLUG_ATTEMPTS || !isUniqueViolation(error, "workspace_members_ws_slug_key")) {
          throw error
        }
      }
    }
  }

  async updateUserProfile(
    userId: string,
    workspaceId: string,
    params: { name?: string; description?: string | null }
  ): Promise<WorkspaceUser> {
    return withTransaction(this.pool, async (client) => {
      const updated = await WorkspaceRepository.updateUser(client, userId, params)
      if (!updated) {
        throw new HttpError("Member not found", { status: 404, code: "MEMBER_NOT_FOUND" })
      }

      const fullUser = await UserRepository.findById(client, userId)
      if (fullUser) {
        await OutboxRepository.insert(client, "member:updated", {
          workspaceId,
          member: serializeBigInt(fullUser),
        })
      }

      return updated
    })
  }

  async uploadAvatar(userId: string, workspaceId: string, buffer: Buffer): Promise<WorkspaceUser> {
    // Phase 1: Verify user exists and capture current avatar for replacement tracking
    const user = await UserRepository.findById(this.pool, userId)
    if (!user || user.workspaceId !== workspaceId) {
      throw new HttpError("Member not found", { status: 404, code: "MEMBER_NOT_FOUND" })
    }

    // Phase 2: Upload raw buffer to S3 (single fast PUT, no processing)
    const rawS3Key = await this.avatarService.uploadRaw({ buffer, workspaceId, memberId: userId })

    // Phase 3: Create upload tracking row and enqueue job
    const uploadId = avatarUploadId()
    try {
      await AvatarUploadRepository.insert(this.pool, {
        id: uploadId,
        workspaceId,
        memberId: userId,
        rawS3Key,
        replacesAvatarUrl: user.avatarUrl,
      })
    } catch (error) {
      this.avatarService.deleteRawFile(rawS3Key)
      throw error
    }

    await this.jobQueue.send(JobQueues.AVATAR_PROCESS, {
      workspaceId,
      avatarUploadId: uploadId,
    })

    return user
  }

  async removeUserAvatar(userId: string, workspaceId: string): Promise<WorkspaceUser> {
    let oldAvatarUrl: string | null = null

    const updated = await withTransaction(this.pool, async (client) => {
      const currentUser = await UserRepository.findById(client, userId)
      oldAvatarUrl = currentUser?.avatarUrl ?? null

      // Delete any in-flight upload rows — racing workers will see their row gone and skip
      await AvatarUploadRepository.deleteByMemberId(client, userId)

      const result = await WorkspaceRepository.updateUser(client, userId, {
        avatarUrl: null,
      })
      if (!result) {
        throw new HttpError("Member not found", { status: 404, code: "MEMBER_NOT_FOUND" })
      }

      const fullUser = await UserRepository.findById(client, userId)
      if (fullUser) {
        await OutboxRepository.insert(client, "member:updated", {
          workspaceId,
          member: serializeBigInt(fullUser),
        })
      }

      return result
    })

    if (oldAvatarUrl) {
      this.avatarService.deleteAvatarFiles(oldAvatarUrl)
    }

    return updated
  }

  private async shouldPreferEmailSlug(orgId: string | null, email: string): Promise<boolean> {
    if (!this.workosOrgService || !orgId) return false

    const org = await this.workosOrgService.getOrganization(orgId)
    if (!org || org.domains.length === 0) return false

    const emailDomain = email.split("@")[1]?.toLowerCase()
    return org.domains.some((d) => d.toLowerCase() === emailDomain)
  }

  // Backward-compatible aliases while call sites migrate.
  addMember(wsId: string, params: Parameters<WorkspaceService["addUser"]>[1]) {
    return this.addUser(wsId, params)
  }

  createMemberInTransaction(client: Querier, params: Parameters<WorkspaceService["createUserInTransaction"]>[1]) {
    return this.createUserInTransaction(client, params)
  }

  removeMember(workspaceId: string, memberId: string) {
    return this.removeUser(workspaceId, memberId)
  }

  getMembers(workspaceId: string) {
    return this.getUsers(workspaceId)
  }

  completeMemberSetup(
    memberId: string,
    workspaceId: string,
    params: Parameters<WorkspaceService["completeUserSetup"]>[2]
  ) {
    return this.completeUserSetup(memberId, workspaceId, params)
  }

  updateMemberProfile(
    memberId: string,
    workspaceId: string,
    params: Parameters<WorkspaceService["updateUserProfile"]>[2]
  ) {
    return this.updateUserProfile(memberId, workspaceId, params)
  }

  removeMemberAvatar(memberId: string, workspaceId: string) {
    return this.removeUserAvatar(memberId, workspaceId)
  }
}
