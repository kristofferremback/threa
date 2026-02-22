/**
 * Workspace fixtures for evaluations.
 *
 * Creates a workspace with a test user for evaluation cases.
 */

import type { Pool } from "pg"
import { withTransaction } from "../../src/db"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { workspaceId, memberId } from "../../src/lib/id"

/**
 * Workspace fixture data created for evals.
 */
export interface WorkspaceFixture {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  userId: string // WorkOS user ID
  userName: string
  userEmail: string
}

/**
 * Create a workspace fixture for evaluations.
 *
 * Creates:
 * - A test user
 * - A test workspace
 * - The user as owner of the workspace
 */
export async function createWorkspaceFixture(pool: Pool): Promise<WorkspaceFixture> {
  const wsId = workspaceId()
  const timestamp = Date.now()
  const workosUserId = `workos_eval_${timestamp}`
  const ownerMemberId = memberId()
  const userName = `Eval User ${timestamp}`
  const userEmail = `eval-user-${timestamp}@test.local`

  const fixture = await withTransaction(pool, async (client) => {
    // Create workspace
    const workspace = await WorkspaceRepository.insert(client, {
      id: wsId,
      name: `Eval Workspace ${timestamp}`,
      slug: `eval-workspace-${timestamp}`,
      createdBy: ownerMemberId,
    })

    // Add owner user
    await WorkspaceRepository.addUser(client, {
      id: ownerMemberId,
      workspaceId: workspace.id,
      workosUserId,
      email: userEmail,
      slug: `eval-user-${timestamp}`,
      name: userName,
      role: "owner",
    })

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      userId: workosUserId,
      userName,
      userEmail,
    }
  })

  return fixture
}

/**
 * Create additional users in a workspace.
 * Useful for testing multi-participant scenarios.
 */
export async function createAdditionalUser(
  pool: Pool,
  workspaceId: string,
  options: {
    name?: string
    email?: string
    timezone?: string
  } = {}
): Promise<{ userId: string; userName: string; userEmail: string }> {
  const timestamp = Date.now()
  const workosUserId = `workos_eval_${timestamp}`
  const userName = options.name ?? `Eval User ${timestamp}`
  const userEmail = options.email ?? `eval-user-${timestamp}@test.local`

  const result = await withTransaction(pool, async (client) => {
    // Add to workspace as user
    await WorkspaceRepository.addUser(client, {
      id: memberId(),
      workspaceId,
      workosUserId,
      email: userEmail,
      slug: `eval-user-${timestamp}`,
      name: userName,
      role: "member",
      timezone: options.timezone,
    })

    return {
      userId: workosUserId,
      userName,
      userEmail,
    }
  })

  return result
}
