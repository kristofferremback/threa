/**
 * Workspace fixtures for evaluations.
 *
 * Creates a workspace with a test user for evaluation cases.
 */

import type { Pool } from "pg"
import { withTransaction } from "../../src/db"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { UserRepository } from "../../src/auth/user-repository"
import { workspaceId, userId, memberId } from "../../src/lib/id"

/**
 * Workspace fixture data created for evals.
 */
export interface WorkspaceFixture {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  userId: string
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
  const usrId = userId()
  const timestamp = Date.now()

  const fixture = await withTransaction(pool, async (client) => {
    // Create test user
    const user = await UserRepository.insert(client, {
      id: usrId,
      email: `eval-user-${timestamp}@test.local`,
      name: `Eval User ${timestamp}`,
    })

    // Create workspace
    const workspace = await WorkspaceRepository.insert(client, {
      id: wsId,
      name: `Eval Workspace ${timestamp}`,
      slug: `eval-workspace-${timestamp}`,
      createdBy: user.id,
    })

    // Add user as owner
    await WorkspaceRepository.addMember(client, {
      id: memberId(),
      workspaceId: workspace.id,
      userId: user.id,
      slug: `eval-user-${timestamp}`,
      name: user.name,
      role: "owner",
    })

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
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
  const usrId = userId()
  const timestamp = Date.now()

  const result = await withTransaction(pool, async (client) => {
    const user = await UserRepository.insert(client, {
      id: usrId,
      email: options.email ?? `eval-user-${timestamp}@test.local`,
      name: options.name ?? `Eval User ${timestamp}`,
    })

    // Update timezone if provided
    if (options.timezone) {
      await client.query(`UPDATE users SET timezone = $1 WHERE id = $2`, [options.timezone, user.id])
    }

    // Add to workspace as member
    await WorkspaceRepository.addMember(client, {
      id: memberId(),
      workspaceId,
      userId: user.id,
      slug: `eval-user-${timestamp}`,
      name: user.name,
      role: "member",
    })

    return {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
    }
  })

  return result
}
