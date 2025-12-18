import { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import { UserRepository, User, InsertUserParams } from "../repositories"
import { userId } from "../lib/id"

export class UserService {
  constructor(private pool: Pool) {}

  async getUserById(id: string): Promise<User | null> {
    return withClient(this.pool, (client) => UserRepository.findById(client, id))
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return withClient(this.pool, (client) => UserRepository.findByEmail(client, email))
  }

  async getUserByWorkosUserId(workosUserId: string): Promise<User | null> {
    return withClient(this.pool, (client) => UserRepository.findByWorkosUserId(client, workosUserId))
  }

  async ensureUser(params: Omit<InsertUserParams, "id">): Promise<User> {
    return withTransaction(this.pool, async (client) => {
      return UserRepository.upsertByEmail(client, {
        id: userId(),
        ...params,
      })
    })
  }
}
