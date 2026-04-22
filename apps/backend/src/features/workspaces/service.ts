import { Pool } from "pg"
import { withTransaction, withClient, type Querier } from "../../db"
import { WorkspaceRepository, Workspace } from "./repository"
import { UserRepository, type User } from "./user-repository"
import { WorkosAuthzMirrorRepository } from "./workos-authz-mirror-repository"
import { OutboxRepository } from "../../lib/outbox"
import { StreamRepository, StreamMemberRepository } from "../streams"
import { EmojiUsageRepository } from "../emoji"
import { PersonaRepository, type Persona } from "../agents"
import { workspaceId, userId as generateUserId, streamId, avatarUploadId } from "../../lib/id"
import { generateSlug, generateUniqueSlug, serializeBigInt } from "@threa/backend-common"
import { HttpError, isUniqueViolation } from "../../lib/errors"
import { logger } from "../../lib/logger"
import { JobQueues } from "../../lib/queue"
import type { QueueManager } from "../../lib/queue"
import type { WorkosOrgService } from "@threa/backend-common"
import type { WorkspaceAuthzSnapshot, WorkspaceRole } from "@threa/types"
import { UserApiKeyRepository } from "../user-api-keys"
import { AvatarUploadRepository } from "./avatar-upload-repository"
import type { AvatarService } from "./avatar-service"
import { ADMIN_COMPATIBILITY_PERMISSIONS, workosRoleSlugFromCompatibilityRole } from "../../middleware/authorization"
import { decorateUserWithAuthzMirror, decorateUsersWithAuthzMirror } from "./user-authz-decorator"

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

interface WorkspaceServiceOptions {
  requireWorkspaceCreationInvite?: boolean
}

export class WorkspaceService {
  private pool: Pool
  private workosOrgService: WorkosOrgService | null
  private avatarService: AvatarService
  private jobQueue: QueueManager
  private requireWorkspaceCreationInvite: boolean

  constructor(
    pool: Pool,
    avatarService: AvatarService,
    jobQueue: QueueManager,
    workosOrgService?: WorkosOrgService,
    options?: WorkspaceServiceOptions
  ) {
    this.pool = pool
    this.avatarService = avatarService
    this.jobQueue = jobQueue
    this.workosOrgService = workosOrgService ?? null
    this.requireWorkspaceCreationInvite = options?.requireWorkspaceCreationInvite ?? false
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

  /**
   * Create a workspace from a control-plane instruction.
   * Accepts a pre-generated ID and slug — skips invite validation and slug generation
   * since the control-plane already handled those.
   *
   * Idempotent: if the workspace already exists (e.g. control-plane retrying after
   * its local DB commit failed), returns the existing workspace instead of failing.
   */
  async createWorkspaceFromControlPlane(params: {
    id: string
    name: string
    slug: string
    ownerWorkosUserId: string
    ownerEmail: string
    ownerName: string
  }): Promise<Workspace> {
    try {
      const workspace = await withTransaction(this.pool, async (client) => {
        const ownerUserId = generateUserId()

        const ws = await WorkspaceRepository.insert(client, {
          id: params.id,
          name: params.name,
          slug: params.slug,
          createdBy: ownerUserId,
        })

        await this.createUserInTransaction(client, {
          id: ownerUserId,
          workspaceId: params.id,
          workosUserId: params.ownerWorkosUserId,
          email: params.ownerEmail,
          name: params.ownerName,
          role: "admin",
        })

        return ws
      })

      await this.ensureWorkosMembership(params.id, params.ownerWorkosUserId, "admin")
      return workspace
    } catch (error) {
      // Idempotency guard: if this exact workspace PK already exists, return it.
      // Only catch PK collisions — slug or other constraint violations are real errors.
      if (isUniqueViolation(error, "workspaces_pkey")) {
        const existing = await WorkspaceRepository.findById(this.pool, params.id)
        if (existing) return existing
      }
      throw error
    }
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    if (this.requireWorkspaceCreationInvite) {
      await this.assertWorkspaceCreationAllowed(params.email)
    }

    const workspace = await withTransaction(this.pool, async (client) => {
      const id = workspaceId()
      const ownerUserId = generateUserId()
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
        role: "admin",
        setupCompleted: params.setupCompleted,
      })

      return ws
    })

    await this.ensureWorkosMembership(workspace.id, params.workosUserId, "admin")
    return workspace
  }

  private async assertWorkspaceCreationAllowed(email: string): Promise<void> {
    if (!this.workosOrgService) {
      throw new HttpError("Workspace invite validation is not configured", {
        status: 500,
        code: "WORKSPACE_INVITE_VALIDATION_NOT_CONFIGURED",
      })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const hasWorkspaceCreationInvite =
      await this.workosOrgService.hasAcceptedWorkspaceCreationInvitation(normalizedEmail)
    if (!hasWorkspaceCreationInvite) {
      throw new HttpError("Workspace creation requires a dedicated workspace invite.", {
        status: 403,
        code: "WORKSPACE_CREATION_INVITE_REQUIRED",
      })
    }
  }

  async addUser(
    wsId: string,
    params: {
      workosUserId: string
      email: string
      name: string
      role?: User["role"]
      setupCompleted?: boolean
    }
  ): Promise<User> {
    const user = await withTransaction(this.pool, async (client) => {
      return this.createUserInTransaction(client, {
        workspaceId: wsId,
        workosUserId: params.workosUserId,
        email: params.email,
        name: params.name,
        role: params.role ?? "user",
        setupCompleted: params.setupCompleted,
      })
    })

    await this.ensureWorkosMembership(wsId, params.workosUserId, params.role ?? "user")
    return user
  }

  async createUserInTransaction(
    client: Querier,
    params: {
      id?: string
      workspaceId: string
      workosUserId: string
      email: string
      name: string
      role: User["role"]
      setupCompleted?: boolean
    }
  ): Promise<User> {
    const normalizedEmail = params.email.trim().toLowerCase()
    const userSlug = await generateUniqueSlug(params.name, (s) =>
      UserRepository.slugExistsInWorkspace(client, params.workspaceId, s)
    )

    const user = await UserRepository.insert(client, {
      id: params.id ?? generateUserId(),
      workspaceId: params.workspaceId,
      workosUserId: params.workosUserId,
      email: normalizedEmail,
      slug: userSlug,
      name: params.name,
      role: params.role,
      setupCompleted: params.setupCompleted,
    })

    await OutboxRepository.insert(client, "workspace_user:added", {
      workspaceId: params.workspaceId,
      user: serializeBigInt(user),
    })

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
      await UserApiKeyRepository.revokeAllByUser(client, workspaceId, userId)
      await UserRepository.remove(client, workspaceId, userId)

      await OutboxRepository.insert(client, "workspace_user:removed", {
        workspaceId,
        removedUserId: userId,
      })
    })
  }

  async getUsers(workspaceId: string): Promise<User[]> {
    return UserRepository.listByWorkspace(this.pool, workspaceId)
  }

  async getUsersWithRoles(workspaceId: string, roles?: WorkspaceRole[]): Promise<User[]> {
    const users = await this.getUsers(workspaceId)
    return decorateUsersWithAuthzMirror(this.pool, workspaceId, users, { roles })
  }

  async listAssignableRoles(workspaceId: string): Promise<WorkspaceRole[]> {
    const orgId = await WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
    if (!orgId) {
      throw new HttpError("Workspace is not configured for WorkOS authorization", {
        status: 500,
        code: "WORKSPACE_AUTHORIZATION_NOT_CONFIGURED",
      })
    }
    return WorkosAuthzMirrorRepository.listRoles(this.pool, workspaceId)
  }

  async updateUserRole(workspaceId: string, userId: string, roleSlug: string): Promise<User> {
    if (!this.workosOrgService) {
      throw new HttpError("WorkOS role management is not configured", {
        status: 500,
        code: "WORKOS_ROLE_MANAGEMENT_NOT_CONFIGURED",
      })
    }

    const [workspace, localUser] = await Promise.all([
      WorkspaceRepository.findById(this.pool, workspaceId),
      UserRepository.findById(this.pool, workspaceId, userId),
    ])
    if (!workspace || !localUser) {
      throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
    }
    const [roles, assignment] = await Promise.all([
      WorkosAuthzMirrorRepository.listRoles(this.pool, workspaceId),
      WorkosAuthzMirrorRepository.findMembershipAssignment(this.pool, workspaceId, localUser.workosUserId),
    ])
    const rolesBySlug = new Map(roles.map((role) => [role.slug, role]))
    const nextRole = rolesBySlug.get(roleSlug)
    if (!nextRole) {
      throw new HttpError("Role not found", { status: 404, code: "ROLE_NOT_FOUND" })
    }

    if (!assignment) {
      throw new HttpError("WorkOS organization membership not found", {
        status: 404,
        code: "WORKOS_MEMBERSHIP_NOT_FOUND",
      })
    }

    const currentRoleSlugs = assignment.roleSlugs
    if (currentRoleSlugs.length > 1) {
      throw new HttpError("This user has multiple roles and cannot be edited in-app yet", {
        status: 409,
        code: "MULTIPLE_ROLES_NOT_EDITABLE",
      })
    }

    const targetCurrentlyAdmin = currentRoleSlugs.some((slug) =>
      (rolesBySlug.get(slug)?.permissions ?? []).some((permission) => ADMIN_COMPATIBILITY_PERMISSIONS.has(permission))
    )
    const targetWillBeAdmin = nextRole.permissions.some((permission) => ADMIN_COMPATIBILITY_PERMISSIONS.has(permission))

    const workosOrgService = this.workosOrgService
    const decoratedUpdatedUser = await withTransaction(this.pool, async (client) => {
      // Serialize role mutations per-workspace so the last-admin guard cannot be
      // bypassed by two concurrent demotions both reading the pre-mutation state.
      // This deliberately keeps the transaction open across the WorkOS call below:
      // rare admin-role changes are worth the invariant exception because the lock
      // must cover the guard, the external mutation, and the local mirror update.
      // The advisory lock is released when the transaction ends.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        "workspace_role_mutation",
        workspaceId,
      ])

      if (targetCurrentlyAdmin && !targetWillBeAdmin) {
        const otherAdminExists = await WorkosAuthzMirrorRepository.hasOtherRoleManager(
          client,
          workspaceId,
          assignment.organizationMembershipId
        )
        if (!otherAdminExists) {
          throw new HttpError("Workspace must retain at least one member who can manage roles", {
            status: 409,
            code: "LAST_ADMIN_NOT_ALLOWED",
          })
        }
      }

      await workosOrgService.updateOrganizationMembership({
        organizationMembershipId: assignment.organizationMembershipId,
        roleSlug,
      })

      await WorkosAuthzMirrorRepository.upsertMembershipRoles({
        db: client,
        workspaceId,
        organizationMembershipId: assignment.organizationMembershipId,
        workosUserId: localUser.workosUserId,
        roleSlugs: [roleSlug],
      })
      await WorkosAuthzMirrorRepository.syncCompatibilityRoles(client, workspaceId)

      const updatedUser = await UserRepository.findById(client, workspaceId, userId)
      if (!updatedUser) {
        throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
      }

      const decoratedUser = await decorateUserWithAuthzMirror(client, workspaceId, updatedUser, { workspace })

      await OutboxRepository.insert(client, "workspace_user:updated", {
        workspaceId,
        user: serializeBigInt(decoratedUser),
      })

      return decoratedUser
    })

    return decoratedUpdatedUser
  }

  async applyWorkosAuthzSnapshot(snapshot: WorkspaceAuthzSnapshot): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const workspace = await WorkspaceRepository.findById(client, snapshot.workspaceId)
      if (!workspace) {
        throw new HttpError("Workspace not found", { status: 404, code: "WORKSPACE_NOT_FOUND" })
      }

      const applied = await WorkosAuthzMirrorRepository.applySnapshot(client, snapshot)
      if (!applied) {
        return false
      }

      await WorkosAuthzMirrorRepository.syncCompatibilityRoles(client, snapshot.workspaceId)

      const decoratedUsers = await decorateUsersWithAuthzMirror(
        client,
        snapshot.workspaceId,
        await UserRepository.listByWorkspace(client, snapshot.workspaceId),
        { workspace }
      )
      if (decoratedUsers.length > 0) {
        await OutboxRepository.insertMany(
          client,
          decoratedUsers.map((user) => ({
            eventType: "workspace_user:updated" as const,
            payload: {
              workspaceId: snapshot.workspaceId,
              user: serializeBigInt(user),
            },
          }))
        )
      }

      return true
    })
  }

  async isMember(workspaceId: string, workosUserId: string): Promise<boolean> {
    return UserRepository.isMember(this.pool, workspaceId, workosUserId)
  }

  async getPersonasForWorkspace(workspaceId: string): Promise<Persona[]> {
    return PersonaRepository.listForWorkspace(this.pool, workspaceId)
  }

  async getEmojiWeights(workspaceId: string, userId: string): Promise<Record<string, number>> {
    return EmojiUsageRepository.getWeights(this.pool, workspaceId, userId)
  }

  async isSlugAvailable(workspaceId: string, slug: string, excludeUserId?: string): Promise<boolean> {
    if (excludeUserId) {
      const user = await UserRepository.findById(this.pool, workspaceId, excludeUserId)
      if (user && user.slug === slug) return true
    }
    const exists = await UserRepository.slugExistsInWorkspace(this.pool, workspaceId, slug)
    return !exists
  }

  async completeUserSetup(
    userId: string,
    workspaceId: string,
    params: { name?: string; slug?: string; timezone: string; locale: string }
  ): Promise<User> {
    // Phase 1: Fast reads
    const { user, orgId } = await withClient(this.pool, async (client) => {
      const user = await UserRepository.findById(client, workspaceId, userId)
      if (!user) {
        throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
      }

      if (user.setupCompleted) {
        throw new HttpError("User setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
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
          const currentUser = await UserRepository.findById(client, workspaceId, userId)
          if (!currentUser || currentUser.setupCompleted) {
            throw new HttpError("User setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
          }

          let slug: string

          if (preferEmailSlug) {
            slug = deriveSlugFromEmail(currentUser.email)
          } else if (params.slug) {
            slug = generateSlug(params.slug)
          } else {
            const slugBaseName = params.name ?? currentUser.name
            slug = await generateUniqueSlug(slugBaseName, (s) =>
              UserRepository.slugExistsInWorkspace(client, workspaceId, s)
            )
          }

          const slugExists = await UserRepository.slugExistsInWorkspace(client, workspaceId, slug)
          if (slugExists && slug !== currentUser.slug) {
            slug = await generateUniqueSlug(slug, (s) => UserRepository.slugExistsInWorkspace(client, workspaceId, s))
          }

          const updated = await UserRepository.update(client, workspaceId, userId, {
            slug,
            name: params.name,
            timezone: params.timezone,
            locale: params.locale,
            setupCompleted: true,
          })

          if (!updated) {
            throw new HttpError("User setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
          }

          const decoratedUser = await decorateUserWithAuthzMirror(client, workspaceId, updated)

          await OutboxRepository.insert(client, "workspace_user:updated", {
            workspaceId,
            user: serializeBigInt(decoratedUser),
          })

          return decoratedUser
        })
      } catch (error) {
        if (attempt >= MAX_SLUG_ATTEMPTS || !isUniqueViolation(error, "users_workspace_slug_key")) {
          throw error
        }
      }
    }
  }

  async updateUserProfile(
    userId: string,
    workspaceId: string,
    params: {
      name?: string
      description?: string | null
      pronouns?: string | null
      phone?: string | null
      githubUsername?: string | null
    }
  ): Promise<User> {
    return withTransaction(this.pool, async (client) => {
      const updated = await UserRepository.update(client, workspaceId, userId, params)
      if (!updated) {
        throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
      }

      const decoratedUser = await decorateUserWithAuthzMirror(client, workspaceId, updated)

      await OutboxRepository.insert(client, "workspace_user:updated", {
        workspaceId,
        user: serializeBigInt(decoratedUser),
      })

      return decoratedUser
    })
  }

  async uploadAvatar(userId: string, workspaceId: string, buffer: Buffer): Promise<User> {
    // Phase 1: Verify user exists and capture current avatar for replacement tracking
    const user = await UserRepository.findById(this.pool, workspaceId, userId)
    if (!user) {
      throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
    }

    // Phase 2: Upload raw buffer to S3 (single fast PUT, no processing)
    const rawS3Key = await this.avatarService.uploadRaw({ buffer, workspaceId, userId })

    // Phase 3: Create upload tracking row and enqueue job
    const uploadId = avatarUploadId()
    try {
      await AvatarUploadRepository.insert(this.pool, {
        id: uploadId,
        workspaceId,
        userId,
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

    return decorateUserWithAuthzMirror(this.pool, workspaceId, user)
  }

  async removeUserAvatar(userId: string, workspaceId: string): Promise<User> {
    let oldAvatarUrl: string | null = null

    const updated = await withTransaction(this.pool, async (client) => {
      const currentUser = await UserRepository.findById(client, workspaceId, userId)
      oldAvatarUrl = currentUser?.avatarUrl ?? null

      // Delete any in-flight upload rows — racing workers will see their row gone and skip
      await AvatarUploadRepository.deleteByUserId(client, userId)

      const result = await UserRepository.update(client, workspaceId, userId, {
        avatarUrl: null,
      })
      if (!result) {
        throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
      }

      const decoratedUser = await decorateUserWithAuthzMirror(client, workspaceId, result)

      await OutboxRepository.insert(client, "workspace_user:updated", {
        workspaceId,
        user: serializeBigInt(decoratedUser),
      })

      return decoratedUser
    })

    if (oldAvatarUrl) {
      this.avatarService.deleteAvatarFiles(oldAvatarUrl)
    }

    return updated
  }

  /**
   * Ensure a WorkOS organization exists for the given workspace.
   * 3-tier lookup: local cache → WorkOS by external ID → create new.
   * No DB connection held during WorkOS API calls (INV-41).
   */
  async ensureWorkosOrganization(workspaceId: string): Promise<string | null> {
    if (!this.workosOrgService) return null

    // Tier 1: Local DB cache
    const cached = await WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
    if (cached) return cached

    // Tier 2: WorkOS by external ID
    const existing = await this.workosOrgService.getOrganizationByExternalId(workspaceId)
    if (existing) {
      await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, existing.id)
      return existing.id
    }

    // Tier 3: Create new (with concurrent-creation race guard)
    const workspace = await WorkspaceRepository.findById(this.pool, workspaceId)
    if (!workspace) return null

    try {
      const org = await this.workosOrgService.createOrganization({
        name: workspace.name,
        externalId: workspaceId,
      })
      await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, org.id)
    } catch (error) {
      logger.error({ err: error, workspaceId }, "Failed to create WorkOS organization")
    }

    // Re-read to get the winning org ID (handles concurrent creation race)
    return WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
  }

  private async ensureWorkosMembership(workspaceId: string, workosUserId: string, role: User["role"]): Promise<void> {
    if (!this.workosOrgService) return

    const orgId = await this.ensureWorkosOrganization(workspaceId)
    if (!orgId) {
      logger.error({ workspaceId, workosUserId }, "Failed to provision WorkOS organization for workspace user")
      throw new HttpError("Failed to provision WorkOS organization for workspace user", {
        status: 503,
        code: "WORKOS_MEMBERSHIP_PROVISIONING_FAILED",
      })
    }

    try {
      await this.workosOrgService.ensureOrganizationMembership({
        organizationId: orgId,
        userId: workosUserId,
        roleSlug: workosRoleSlugFromCompatibilityRole(role),
      })
    } catch (error) {
      logger.error(
        { err: error, workspaceId, workosUserId, roleSlug: workosRoleSlugFromCompatibilityRole(role) },
        "Failed to provision WorkOS organization membership for workspace user"
      )
      throw new HttpError("Failed to provision WorkOS organization membership for workspace user", {
        status: 503,
        code: "WORKOS_MEMBERSHIP_PROVISIONING_FAILED",
      })
    }
  }

  private async shouldPreferEmailSlug(orgId: string | null, email: string): Promise<boolean> {
    if (!this.workosOrgService || !orgId) return false

    const org = await this.workosOrgService.getOrganization(orgId)
    if (!org || org.domains.length === 0) return false

    const emailDomain = email.split("@")[1]?.toLowerCase()
    return org.domains.some((d) => d.toLowerCase() === emailDomain)
  }
}
