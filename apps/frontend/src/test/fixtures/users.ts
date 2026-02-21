import type { WorkspaceMember } from "@threa/types"

/**
 * Factory for creating mock WorkspaceMember objects.
 */
export function createMockMember(
  overrides: Partial<WorkspaceMember> & { id: string; workosUserId: string }
): WorkspaceMember {
  return {
    workspaceId: "workspace_1",
    email: `${overrides.workosUserId}@test.com`,
    role: "member",
    slug: overrides.workosUserId.replace("workos_", ""),
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
 * Pre-built mock workspace members.
 */
export const mockMembers = {
  martin: createMockMember({
    id: "member_1",
    workosUserId: "workos_user_1",
    role: "admin",
    slug: "martin",
    name: "Martin",
    email: "martin@test.com",
  }),
  kate: createMockMember({
    id: "member_2",
    workosUserId: "workos_user_2",
    role: "member",
    slug: "kate",
    name: "Kate",
    email: "kate@test.com",
  }),
  alice: createMockMember({
    id: "member_3",
    workosUserId: "workos_user_3",
    role: "member",
    slug: "alice",
    name: "Alice",
    email: "alice@test.com",
  }),
}

/**
 * Array of all mock members.
 */
export const mockMembersList: WorkspaceMember[] = Object.values(mockMembers)
