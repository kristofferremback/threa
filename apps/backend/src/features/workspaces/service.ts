import { Pool } from "pg"
import { withTransaction, withClient, type Querier } from "../../db"
import { WorkspaceRepository, Workspace, WorkspaceMember } from "./repository"
import { MemberRepository, Member } from "./member-repository"
import { OutboxRepository } from "../../lib/outbox"
import { StreamRepository, StreamMemberRepository } from "../streams"
import { EmojiUsageRepository } from "../emoji"
import { UserRepository, User } from "../../auth/user-repository"
import { PersonaRepository, type Persona } from "../agents"
import { workspaceId, memberId as generateMemberId, streamId } from "../../lib/id"
import { generateSlug, generateUniqueSlug } from "../../lib/slug"
import { serializeBigInt } from "../../lib/serialization"
import { HttpError } from "../../lib/errors"
import type { WorkosOrgService } from "../../auth/workos-org-service"

function deriveSlugFromEmail(email: string): string {
  const prefix = email.split("@")[0]
  return generateSlug(prefix)
}

export interface CreateWorkspaceParams {
  name: string
  createdBy: string
}

export class WorkspaceService {
  private pool: Pool
  private workosOrgService: WorkosOrgService | null

  constructor(pool: Pool, workosOrgService?: WorkosOrgService) {
    this.pool = pool
    this.workosOrgService = workosOrgService ?? null
  }

  async getWorkspaceById(id: string): Promise<Workspace | null> {
    return WorkspaceRepository.findById(this.pool, id)
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return WorkspaceRepository.findBySlug(this.pool, slug)
  }

  async getWorkspacesByUserId(userId: string): Promise<Workspace[]> {
    return WorkspaceRepository.list(this.pool, { userId })
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    return withTransaction(this.pool, async (client) => {
      const id = workspaceId()
      const slug = await generateUniqueSlug(params.name, (slug) => WorkspaceRepository.slugExists(client, slug))

      const ws = await WorkspaceRepository.insert(client, {
        id,
        name: params.name,
        slug,
        createdBy: params.createdBy,
      })

      await this.createMemberInTransaction(client, {
        workspaceId: id,
        userId: params.createdBy,
        role: "owner",
      })

      return ws
    })
  }

  async addMember(wsId: string, userId: string, role: WorkspaceMember["role"] = "member"): Promise<WorkspaceMember> {
    return withTransaction(this.pool, async (client) => {
      return this.createMemberInTransaction(client, { workspaceId: wsId, userId, role })
    })
  }

  async createMemberInTransaction(
    client: Querier,
    params: { workspaceId: string; userId: string; role: WorkspaceMember["role"]; setupCompleted?: boolean }
  ): Promise<WorkspaceMember> {
    const user = await UserRepository.findById(client, params.userId)
    const memberSlug = user
      ? await generateUniqueSlug(user.name, (s) => WorkspaceRepository.memberSlugExists(client, params.workspaceId, s))
      : `member-${generateMemberId().slice(7, 15)}`

    const m = await WorkspaceRepository.addMember(client, {
      id: generateMemberId(),
      workspaceId: params.workspaceId,
      userId: params.userId,
      slug: memberSlug,
      name: user?.name ?? "",
      role: params.role,
      setupCompleted: params.setupCompleted,
    })

    const fullMember = await MemberRepository.findById(client, m.id)
    if (fullMember) {
      await OutboxRepository.insert(client, "workspace_member:added", {
        workspaceId: params.workspaceId,
        member: serializeBigInt(fullMember),
      })
    }

    const sId = streamId()
    const stream = await StreamRepository.insertSystemStream(client, {
      id: sId,
      workspaceId: params.workspaceId,
      createdBy: m.id,
    })
    await StreamMemberRepository.insert(client, sId, m.id)
    await OutboxRepository.insert(client, "stream:created", {
      workspaceId: params.workspaceId,
      streamId: sId,
      stream,
    })

    return m
  }

  async removeMember(workspaceId: string, memberId: string): Promise<void> {
    return withTransaction(this.pool, async (client) => {
      await WorkspaceRepository.removeMemberById(client, workspaceId, memberId)

      await OutboxRepository.insert(client, "workspace_member:removed", {
        workspaceId,
        memberId,
      })
    })
  }

  async getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return WorkspaceRepository.listMembers(this.pool, workspaceId)
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    return WorkspaceRepository.isMember(this.pool, workspaceId, userId)
  }

  async getUsersForMembers(members: WorkspaceMember[]): Promise<User[]> {
    if (members.length === 0) return []
    const userIds = members.map((m) => m.userId)
    return UserRepository.findByIds(this.pool, userIds)
  }

  async getPersonasForWorkspace(workspaceId: string): Promise<Persona[]> {
    return PersonaRepository.listForWorkspace(this.pool, workspaceId)
  }

  async getEmojiWeights(workspaceId: string, memberId: string): Promise<Record<string, number>> {
    return EmojiUsageRepository.getWeights(this.pool, workspaceId, memberId)
  }

  async isSlugAvailable(workspaceId: string, slug: string): Promise<boolean> {
    const exists = await WorkspaceRepository.memberSlugExists(this.pool, workspaceId, slug)
    return !exists
  }

  async completeMemberSetup(
    memberId: string,
    workspaceId: string,
    params: { name?: string; slug?: string; timezone: string; locale: string }
  ): Promise<WorkspaceMember> {
    // Phase 1: Fast reads
    const { member, user, orgId } = await withClient(this.pool, async (client) => {
      const member = await MemberRepository.findById(client, memberId)
      if (!member || member.workspaceId !== workspaceId) {
        throw new HttpError("Member not found", { status: 404, code: "MEMBER_NOT_FOUND" })
      }

      if (member.setupCompleted) {
        throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
      }

      const user = await UserRepository.findById(client, member.userId)
      if (!user) throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })

      const orgId = await WorkspaceRepository.getWorkosOrganizationId(client, workspaceId)
      return { member, user, orgId }
    })

    // Phase 2: External API call — no DB connection held
    const enforceEmailSlug = await this.shouldEnforceEmailSlug(orgId, user)

    // Phase 3: Transaction with re-check via WHERE guard on setup_completed
    return withTransaction(this.pool, async (client) => {
      // Re-read member inside transaction to get fresh slug (Phase 1 value may be stale)
      const currentMember = await MemberRepository.findById(client, memberId)
      if (!currentMember || currentMember.setupCompleted) {
        throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
      }

      let slug: string

      if (enforceEmailSlug) {
        slug = deriveSlugFromEmail(user.email)
      } else if (params.slug) {
        slug = generateSlug(params.slug)
      } else {
        slug = await generateUniqueSlug(user.name, (s) => WorkspaceRepository.memberSlugExists(client, workspaceId, s))
      }

      const slugExists = await WorkspaceRepository.memberSlugExists(client, workspaceId, slug)
      if (slugExists && slug !== currentMember.slug) {
        slug = await generateUniqueSlug(slug, (s) => WorkspaceRepository.memberSlugExists(client, workspaceId, s))
      }

      const updated = await WorkspaceRepository.updateMember(client, memberId, {
        slug,
        name: params.name,
        timezone: params.timezone,
        locale: params.locale,
        setupCompleted: true,
      })

      if (!updated) {
        throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
      }

      const fullMember = await MemberRepository.findById(client, memberId)
      if (fullMember) {
        await OutboxRepository.insert(client, "member:updated", {
          workspaceId,
          member: serializeBigInt(fullMember),
        })
      }

      return updated
    })
  }

  private async shouldEnforceEmailSlug(orgId: string | null, user: User): Promise<boolean> {
    if (!this.workosOrgService || !orgId) return false

    const org = await this.workosOrgService.getOrganization(orgId)
    if (!org || org.domains.length === 0) return false

    const emailDomain = user.email.split("@")[1]?.toLowerCase()
    return org.domains.some((d) => d.toLowerCase() === emailDomain)
  }
}
