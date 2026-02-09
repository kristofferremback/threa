import { Pool } from "pg"
import { withTransaction } from "../../db"
import { WorkspaceRepository, Workspace, WorkspaceMember } from "./repository"
import { MemberRepository, Member } from "./member-repository"
import { OutboxRepository, EmojiUsageRepository } from "../../repositories"
import { UserRepository, User } from "../../auth/user-repository"
import { PersonaRepository, type Persona } from "../../repositories"
import { workspaceId, memberId as generateMemberId } from "../../lib/id"
import { generateUniqueSlug } from "../../lib/slug"
import { serializeBigInt } from "../../lib/serialization"

export interface CreateWorkspaceParams {
  name: string
  createdBy: string
}

export class WorkspaceService {
  constructor(private pool: Pool) {}

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

      const workspace = await WorkspaceRepository.insert(client, {
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

      await WorkspaceRepository.addMember(client, {
        id: generateMemberId(),
        workspaceId: id,
        userId: params.createdBy,
        slug: memberSlug,
        role: "owner",
      })

      return workspace
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

      const member = await WorkspaceRepository.addMember(client, {
        id: generateMemberId(),
        workspaceId,
        userId,
        slug: memberSlug,
        role,
      })

      // Look up full member for outbox event
      const fullMember = await MemberRepository.findById(client, member.id)
      if (fullMember) {
        await OutboxRepository.insert(client, "workspace_member:added", {
          workspaceId,
          member: serializeBigInt(fullMember),
        })
      }

      return member
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
}
