import type { Pool } from "pg"
import { InvitationShadowRepository } from "./repository"

interface Dependencies {
  pool: Pool
}

export class InvitationShadowService {
  private pool: Pool

  constructor({ pool }: Dependencies) {
    this.pool = pool
  }

  async findPendingByEmail(email: string) {
    return InvitationShadowRepository.findPendingByEmail(this.pool, email)
  }

  async createShadow(params: { id: string; workspaceId: string; email: string; region: string; expiresAt: Date }) {
    return InvitationShadowRepository.insert(this.pool, params)
  }

  async updateStatus(id: string, status: string) {
    return InvitationShadowRepository.updateStatus(this.pool, id, status)
  }
}
