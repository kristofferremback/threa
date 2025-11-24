#!/usr/bin/env bun
/**
 * Script to add a user to a workspace
 * Usage:
 *   bun run scripts/add-user-to-workspace.ts <email> --workspace-id <id>
 *   bun run scripts/add-user-to-workspace.ts <email> --workspace-name <name>
 */

import { sql } from "bun"
import { logger } from "../src/server/lib/logger"
import { generateId } from "../src/server/lib/id"

interface User {
  id: string
  email: string
  name: string
  created_at: Date
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error(
      "Usage: bun run scripts/add-user-to-workspace.ts <email> --workspace-id <id> | --workspace-name <name>",
    )
    console.error("Example: bun run scripts/add-user-to-workspace.ts user@example.com --workspace-name 'My Workspace'")
    process.exit(1)
  }

  const email = args[0]
  const workspaceIdFlagIndex = args.indexOf("--workspace-id")
  const workspaceNameFlagIndex = args.indexOf("--workspace-name")

  let workspaceId: string | undefined
  let workspaceName: string | undefined

  if (workspaceIdFlagIndex !== -1 && workspaceNameFlagIndex !== -1) {
    console.error("Error: Cannot provide both --workspace-id and --workspace-name. Choose one.")
    process.exit(1)
  }

  if (workspaceIdFlagIndex !== -1) {
    workspaceId = args[workspaceIdFlagIndex + 1]
    if (!workspaceId) {
      console.error("Error: --workspace-id requires a value")
      process.exit(1)
    }
  } else if (workspaceNameFlagIndex !== -1) {
    workspaceName = args[workspaceNameFlagIndex + 1]
    if (!workspaceName) {
      console.error("Error: --workspace-name requires a value")
      process.exit(1)
    }
  } else {
    console.error("Error: Must provide either --workspace-id or --workspace-name")
    process.exit(1)
  }

  // Use Bun's built-in PostgreSQL client
  // It automatically uses DATABASE_URL from environment
  try {
    // Get or create user using Bun's sql
    let userId: string
    const existingUsers = await sql`SELECT id, email, name, created_at FROM users WHERE email = ${email}`

    if (existingUsers.length > 0) {
      userId = existingUsers[0].id
      console.log(`Found existing user: ${email} (${userId})`)
    } else {
      // Create user if they don't exist
      userId = generateId("usr")
      const name = email.split("@")[0] // Use email prefix as name
      await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${email}, ${name})`
      console.log(`Created new user: ${email} (${userId})`)
    }

    // Get or create workspace
    let targetWorkspaceId: string

    if (workspaceId) {
      // Use provided workspace ID
      const workspaces =
        await sql`SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at FROM workspaces WHERE id = ${workspaceId}`

      if (workspaces.length === 0) {
        console.error(`Error: Workspace with ID ${workspaceId} not found`)
        process.exit(1)
      }

      targetWorkspaceId = workspaceId
      console.log(`Using existing workspace: ${workspaces[0].name} (${workspaceId})`)
    } else {
      // Create workspace from name
      const slug =
        workspaceName!
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "") || "workspace"

      // Check if workspace with slug already exists using Bun's sql
      const existingWorkspaces = await sql`SELECT id, name FROM workspaces WHERE slug = ${slug}`

      if (existingWorkspaces.length > 0) {
        targetWorkspaceId = existingWorkspaces[0].id
        console.log(`Using existing workspace: ${existingWorkspaces[0].name} (${targetWorkspaceId})`)
      } else {
        // Create new workspace
        targetWorkspaceId = generateId("ws")
        await sql`INSERT INTO workspaces (id, name, slug, plan_tier, seat_limit)
                  VALUES (${targetWorkspaceId}, ${workspaceName}, ${slug}, 'free', 5)`
        console.log(`Created new workspace: ${workspaceName} (${targetWorkspaceId})`)

        // Create default #general channel
        const channelId = generateId("chan")
        await sql`INSERT INTO channels (id, workspace_id, name, slug, description, visibility)
                  VALUES (${channelId}, ${targetWorkspaceId}, '#general', 'general', 'General discussion', 'public')`
        console.log(`Created default #general channel`)
      }
    }

    // Add user to workspace (check if already a member)
    const existingMember = await sql`
      SELECT role, status FROM workspace_members 
      WHERE workspace_id = ${targetWorkspaceId} AND user_id = ${userId}
    `

    if (existingMember.length > 0) {
      if (existingMember[0].status === "active") {
        console.log(`User ${email} is already an active member of workspace ${targetWorkspaceId}`)
      } else {
        // Reactivate suspended/invited member
        await sql`
          UPDATE workspace_members 
          SET role = 'admin', status = 'active' 
          WHERE workspace_id = ${targetWorkspaceId} AND user_id = ${userId}
        `
        console.log(`✓ Reactivated and set ${email} as admin in workspace ${targetWorkspaceId}`)
      }
    } else {
      // Check seat limit before adding
      const workspace = await sql`SELECT seat_limit FROM workspaces WHERE id = ${targetWorkspaceId}`
      const seatLimit = workspace[0]?.seat_limit

      if (seatLimit !== null) {
        const activeMembers = await sql`
          SELECT COUNT(*) as count FROM workspace_members 
          WHERE workspace_id = ${targetWorkspaceId} AND status = 'active'
        `
        const activeCount = parseInt(activeMembers[0].count)

        if (activeCount >= seatLimit) {
          console.error(`Error: Workspace has reached its seat limit of ${seatLimit}`)
          console.error("Please upgrade the plan or remove other members.")
          process.exit(1)
        }
      }

      // Add new member
      await sql`
        INSERT INTO workspace_members (workspace_id, user_id, role, status)
        VALUES (${targetWorkspaceId}, ${userId}, 'admin', 'active')
      `
      console.log(`✓ Successfully added ${email} as admin to workspace ${targetWorkspaceId}`)
    }

    process.exit(0)
  } catch (error) {
    logger.error({ err: error }, "Failed to add user to workspace")
    console.error("Error:", error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    // Close Bun's SQL connection pool
    await sql.close()
  }
}

main()
