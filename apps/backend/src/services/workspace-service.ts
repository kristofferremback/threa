import { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import { WorkspaceRepository, Workspace, WorkspaceMember, OutboxRepository } from "../repositories"
import { UserRepository, User } from "../repositories/user-repository"
import { PersonaRepository, Persona } from "../repositories/persona-repository"
import { workspaceId } from "../lib/id"
import { generateUniqueSlug } from "../lib/slug"
import { serializeBigInt } from "../lib/serialization"

export interface CreateWorkspaceParams {
  name: string
  createdBy: string
}

export class WorkspaceService {
  constructor(private pool: Pool) {}

  async getWorkspaceById(id: string): Promise<Workspace | null> {
    return withClient(this.pool, (client) => WorkspaceRepository.findById(client, id))
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return withClient(this.pool, (client) => WorkspaceRepository.findBySlug(client, slug))
  }

  async getWorkspacesByUserId(userId: string): Promise<Workspace[]> {
    return withClient(this.pool, (client) => WorkspaceRepository.list(client, { userId }))
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

      // Add creator as owner
      await WorkspaceRepository.addMember(client, id, params.createdBy, "owner")

      return workspace
    })
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"] = "member"
  ): Promise<WorkspaceMember> {
    return withTransaction(this.pool, async (client) => {
      const member = await WorkspaceRepository.addMember(client, workspaceId, userId, role)

      const user = await UserRepository.findById(client, userId)
      if (user) {
        await OutboxRepository.insert(client, "workspace_member:added", {
          workspaceId,
          user: serializeBigInt(user),
        })
      }

      return member
    })
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    return withTransaction(this.pool, async (client) => {
      await WorkspaceRepository.removeMember(client, workspaceId, userId)

      await OutboxRepository.insert(client, "workspace_member:removed", {
        workspaceId,
        userId,
      })
    })
  }

  async getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return withClient(this.pool, (client) => WorkspaceRepository.listMembers(client, workspaceId))
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    return withClient(this.pool, (client) => WorkspaceRepository.isMember(client, workspaceId, userId))
  }

  async getUsersForMembers(members: WorkspaceMember[]): Promise<User[]> {
    if (members.length === 0) return []
    const userIds = members.map((m) => m.userId)
    return withClient(this.pool, (client) => UserRepository.findByIds(client, userIds))
  }

  async getPersonasForWorkspace(workspaceId: string): Promise<Persona[]> {
    return withClient(this.pool, (client) => PersonaRepository.listForWorkspace(client, workspaceId))
  }
}
