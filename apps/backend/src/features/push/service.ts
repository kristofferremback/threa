import type { Pool } from "pg"
import { PushSubscriptionRepository, type PushSubscription, type InsertPushSubscriptionParams } from "./repository"
import { UserSessionRepository, type UserSession } from "./session-repository"

interface PushServiceDeps {
  pool: Pool
}

export class PushService {
  private readonly pool: Pool

  constructor(deps: PushServiceDeps) {
    this.pool = deps.pool
  }

  async subscribe(params: InsertPushSubscriptionParams): Promise<PushSubscription> {
    return PushSubscriptionRepository.insert(this.pool, params)
  }

  async unsubscribe(workspaceId: string, userId: string, endpoint: string): Promise<boolean> {
    return PushSubscriptionRepository.deleteByEndpoint(this.pool, workspaceId, userId, endpoint)
  }

  async getSubscriptions(workspaceId: string, userId: string): Promise<PushSubscription[]> {
    return PushSubscriptionRepository.findByUserId(this.pool, workspaceId, userId)
  }

  async removeSubscription(id: string): Promise<void> {
    return PushSubscriptionRepository.deleteById(this.pool, id)
  }

  async upsertSession(params: { workspaceId: string; userId: string; deviceKey: string }): Promise<UserSession> {
    return UserSessionRepository.upsert(this.pool, params)
  }

  async getActiveSessions(workspaceId: string, userId: string, windowMs: number): Promise<UserSession[]> {
    return UserSessionRepository.getActiveSessions(this.pool, workspaceId, userId, windowMs)
  }
}
