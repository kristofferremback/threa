import type { User, WorkspaceMember } from "@threa/types"

/**
 * Factory for creating mock User objects.
 */
export function createMockUser(overrides: Partial<User> & { id: string }): User {
  return {
    email: `${overrides.id}@test.com`,
    name: "Test User",
    slug: overrides.id.replace("user_", ""),
    workosUserId: null,
    timezone: null,
    locale: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

/**
 * Factory for creating mock WorkspaceMember objects.
 */
export function createMockMember(overrides: Partial<WorkspaceMember> & { userId: string }): WorkspaceMember {
  return {
    workspaceId: "workspace_1",
    role: "member",
    joinedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

/**
 * Pre-built mock users for common test scenarios.
 */
export const mockUsers = {
  martin: createMockUser({ id: "user_1", name: "Martin", slug: "martin" }),
  kate: createMockUser({ id: "user_2", name: "Kate", slug: "kate" }),
  alice: createMockUser({ id: "user_3", name: "Alice", slug: "alice" }),
}

/**
 * Array of all mock users.
 */
export const mockUsersList: User[] = Object.values(mockUsers)

/**
 * Pre-built mock workspace members.
 */
export const mockMembers = {
  martin: createMockMember({ userId: "user_1", role: "admin" }),
  kate: createMockMember({ userId: "user_2", role: "member" }),
  alice: createMockMember({ userId: "user_3", role: "member" }),
}

/**
 * Array of all mock members.
 */
export const mockMembersList: WorkspaceMember[] = Object.values(mockMembers)
