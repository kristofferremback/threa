import { Pool } from "pg"
import { withTransaction } from "../../db"
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

      // Add creator as owner — generate member ID and slug
      const user = await UserRepository.findById(client, params.createdBy)
      const memberSlug = user
        ? await generateUniqueSlug(user.name, (s) => WorkspaceRepository.memberSlugExists(client, id, s))
        : `member-${generateMemberId().slice(7, 15)}`

      const mId = generateMemberId()
      await WorkspaceRepository.addMember(client, {
        id: mId,
        workspaceId: id,
        userId: params.createdBy,
        slug: memberSlug,
        role: "owner",
      })

      // System stream created atomically with member — no upsert needed
      const sId = streamId()
      const stream = await StreamRepository.insertSystemStream(client, { id: sId, workspaceId: id, createdBy: mId })
      await StreamMemberRepository.insert(client, sId, mId)
      await OutboxRepository.insert(client, "stream:created", { workspaceId: id, streamId: sId, stream })

      return ws
    })
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"] = "member"
  ): Promise<WorkspaceMember> {
    return withTransaction(this.pool, async (client) => {
      const user = await UserRepository.findById(client, userId)
      const memberSlug = user
        ? await generateUniqueSlug(user.name, (s) => WorkspaceRepository.memberSlugExists(client, workspaceId, s))
        : `member-${generateMemberId().slice(7, 15)}`

      const m = await WorkspaceRepository.addMember(client, {
        id: generateMemberId(),
        workspaceId,
        userId,
        slug: memberSlug,
        role,
      })

      // Look up full member for outbox event
      const fullMember = await MemberRepository.findById(client, m.id)
      if (fullMember) {
        await OutboxRepository.insert(client, "workspace_member:added", {
          workspaceId,
          member: serializeBigInt(fullMember),
        })
      }

      // System stream created atomically with member — no upsert needed
      const sId = streamId()
      const stream = await StreamRepository.insertSystemStream(client, { id: sId, workspaceId, createdBy: m.id })
      await StreamMemberRepository.insert(client, sId, m.id)
      await OutboxRepository.insert(client, "stream:created", { workspaceId, streamId: sId, stream })

      return m
    })
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

  async completeMemberSetup(
    memberId: string,
    workspaceId: string,
    params: { slug?: string; timezone: string; locale: string }
  ): Promise<WorkspaceMember> {
    return withTransaction(this.pool, async (client) => {
      const member = await WorkspaceRepository.findMemberByUserId(
        client,
        workspaceId,
        // memberId is actually the member ID, look up via member table
        (await MemberRepository.findById(client, memberId))?.userId ?? ""
      )

      if (!member) {
        throw new HttpError("Member not found", { status: 404, code: "MEMBER_NOT_FOUND" })
      }

      if (member.setupCompleted) {
        throw new HttpError("Member setup already completed", { status: 400, code: "SETUP_ALREADY_COMPLETED" })
      }

      // Determine slug
      let slug: string
      const shouldEnforceEmailSlug = await this.shouldEnforceEmailSlug(workspaceId, member.userId)

      if (shouldEnforceEmailSlug) {
        const user = await UserRepository.findById(client, member.userId)
        if (!user) throw new HttpError("User not found", { status: 404, code: "USER_NOT_FOUND" })
        slug = deriveSlugFromEmail(user.email)
      } else if (params.slug) {
        slug = generateSlug(params.slug)
      } else {
        const user = await UserRepository.findById(client, member.userId)
        slug = user
          ? await generateUniqueSlug(user.name, (s) => WorkspaceRepository.memberSlugExists(client, workspaceId, s))
          : `member-${generateMemberId().slice(7, 15)}`
      }

      // Ensure slug uniqueness
      const slugExists = await WorkspaceRepository.memberSlugExists(client, workspaceId, slug)
      if (slugExists && slug !== member.slug) {
        slug = await generateUniqueSlug(slug, (s) => WorkspaceRepository.memberSlugExists(client, workspaceId, s))
      }

      const updated = await WorkspaceRepository.updateMember(client, memberId, {
        slug,
        timezone: params.timezone,
        locale: params.locale,
        setupCompleted: true,
      })

      if (!updated) {
        throw new HttpError("Failed to update member", { status: 500, code: "UPDATE_FAILED" })
      }

      // Look up full member (with name/email from user join) for outbox event
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

  private async shouldEnforceEmailSlug(workspaceId: string, userId: string): Promise<boolean> {
    if (!this.workosOrgService) return false

    const orgId = await WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
    if (!orgId) return false

    const org = await this.workosOrgService.getOrganization(orgId)
    if (!org || org.domains.length === 0) return false

    const user = await UserRepository.findById(this.pool, userId)
    if (!user) return false

    const emailDomain = user.email.split("@")[1]?.toLowerCase()
    return org.domains.some((d) => d.toLowerCase() === emailDomain)
  }
}
