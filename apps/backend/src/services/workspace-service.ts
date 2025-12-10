import { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import {
  WorkspaceRepository,
  Workspace,
  WorkspaceMember,
} from "../repositories"
import { workspaceId } from "../lib/id"

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
}

export interface CreateWorkspaceParams {
  name: string
  createdBy: string
}

export class WorkspaceService {
  constructor(private pool: Pool) {}

  async getWorkspaceById(id: string): Promise<Workspace | null> {
    return withClient(this.pool, (client) =>
      WorkspaceRepository.findById(client, id),
    )
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return withClient(this.pool, (client) =>
      WorkspaceRepository.findBySlug(client, slug),
    )
  }

  async getWorkspacesByUserId(userId: string): Promise<Workspace[]> {
    return withClient(this.pool, (client) =>
      WorkspaceRepository.findByUserId(client, userId),
    )
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    return withTransaction(this.pool, async (client) => {
      const id = workspaceId()
      const slug = generateSlug(params.name)

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
    role: WorkspaceMember["role"] = "member",
  ): Promise<WorkspaceMember> {
    return withTransaction(this.pool, (client) =>
      WorkspaceRepository.addMember(client, workspaceId, userId, role),
    )
  }

  async getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return withClient(this.pool, (client) =>
      WorkspaceRepository.findMembers(client, workspaceId),
    )
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    return withClient(this.pool, (client) =>
      WorkspaceRepository.isMember(client, workspaceId, userId),
    )
  }
}
