import type { Pool } from "pg"
import { PlatformAdminRepository } from "./repository"

export class PlatformAdminService {
  constructor(private pool: Pool) {}

  async isPlatformAdmin(workosUserId: string): Promise<boolean> {
    return PlatformAdminRepository.isPlatformAdmin(this.pool, workosUserId)
  }

  async set(workosUserId: string, isAdmin: boolean): Promise<void> {
    if (isAdmin) {
      await PlatformAdminRepository.grant(this.pool, workosUserId)
    } else {
      await PlatformAdminRepository.revoke(this.pool, workosUserId)
    }
  }
}
