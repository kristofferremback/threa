import type { User, WorkspaceMember } from "@threa/types"

/**
 * Factory for creating mock User objects.
 */
export function createMockUser(overrides: Partial<User> & { id: string }): User {
  return {
    email: `${overrides.id}@test.com`,
    name: "Test User",
    workosUserId: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

/**
 * Factory for creating mock WorkspaceMember objects.
 */
export function createMockMember(
  overrides: Partial<WorkspaceMember> & { id: string; userId: string }
): WorkspaceMember {
  return {
    workspaceId: "workspace_1",
    role: "member",
    slug: overrides.userId.replace("user_", ""),
    name: "Test Member",
    description: null,
    avatarUrl: null,
    timezone: null,
    locale: null,
    setupCompleted: true,
    joinedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

/**
 * Pre-built mock users for common test scenarios.
 */
export const mockUsers = {
  martin: createMockUser({ id: "user_1", name: "Martin" }),
  kate: createMockUser({ id: "user_2", name: "Kate" }),
  alice: createMockUser({ id: "user_3", name: "Alice" }),
}

/**
 * Array of all mock users.
 */
export const mockUsersList: User[] = Object.values(mockUsers)

/**
 * Pre-built mock workspace members.
 */
export const mockMembers = {
  martin: createMockMember({ id: "member_1", userId: "user_1", role: "admin", slug: "martin" }),
  kate: createMockMember({ id: "member_2", userId: "user_2", role: "member", slug: "kate" }),
  alice: createMockMember({ id: "member_3", userId: "user_3", role: "member", slug: "alice" }),
}

/**
 * Array of all mock members.
 */
export const mockMembersList: WorkspaceMember[] = Object.values(mockMembers)
