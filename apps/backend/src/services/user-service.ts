import { Pool } from "pg"
import { UserRepository, User, InsertUserParams } from "../repositories"
import { userId } from "../lib/id"

export class UserService {
  constructor(private pool: Pool) {}

  async getUserById(id: string): Promise<User | null> {
    return UserRepository.findById(this.pool, id)
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return UserRepository.findByEmail(this.pool, email)
  }

  async getUserByWorkosUserId(workosUserId: string): Promise<User | null> {
    return UserRepository.findByWorkosUserId(this.pool, workosUserId)
  }

  async ensureUser(params: Omit<InsertUserParams, "id">): Promise<User> {
    return UserRepository.upsertByEmail(this.pool, {
      id: userId(),
      ...params,
    })
  }
}
