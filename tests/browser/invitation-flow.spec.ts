import { test, expect } from "@playwright/test"

/**
 * Invitation flow E2E test.
 *
 * Tests the complete multi-user flow:
 * 1. User A signs in, creates a workspace, creates a public channel
 * 2. User A invites User B by email via workspace settings
 * 3. User B signs in — auto-accepted into workspace, redirected to setup
 * 4. User B completes member setup (name, slug, timezone, locale)
 * 5. User B sees the workspace with the public channel
 */

test.describe("Invitation Flow", () => {
  const testId = Date.now().toString(36)
  const userAEmail = `inviter-${testId}@example.com`
  const userAName = `Inviter ${testId}`
  const userBEmail = `invitee-${testId}@example.com`
  const userBName = `Invitee ${testId}`
  const workspaceName = `Invite Test ${testId}`
  const channelName = `general-${testId}`

  test("should allow owner to invite a user who then joins and sees the workspace", async ({ browser }) => {
    // ──── User A: Create workspace and invite User B ────

    const contextA = await browser.newContext()
    const pageA = await contextA.newPage()

    // Sign in as User A
    await pageA.goto("/login")
    await pageA.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await expect(pageA.getByRole("heading", { name: "Test Login" })).toBeVisible()
    await pageA.getByLabel("Email").fill(userAEmail)
    await pageA.getByLabel("Name").fill(userAName)
    await pageA.getByRole("button", { name: "Sign In" }).click()

    // Create workspace
    await expect(pageA.getByPlaceholder("New workspace name")).toBeVisible()
    await pageA.getByPlaceholder("New workspace name").fill(workspaceName)
    await pageA.getByRole("button", { name: "Create Workspace" }).click()

    // Verify sidebar is visible
    await expect(pageA.getByRole("button", { name: "+ New Channel" })).toBeVisible()

    // Create a public channel
    pageA.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt")
      await dialog.accept(channelName)
    })
    await pageA.getByRole("button", { name: "+ New Channel" }).click()
    await expect(pageA.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Open workspace settings → Members tab
    await pageA.getByRole("button", { name: "Settings", exact: true }).click()
    await expect(pageA.getByRole("heading", { name: "Workspace Settings" })).toBeVisible()
    await pageA.getByRole("tab", { name: "Members" }).click()

    // Click Invite button
    await pageA.getByRole("button", { name: "Invite" }).click()
    await expect(pageA.getByRole("heading", { name: "Invite Members" })).toBeVisible()

    // Enter User B's email and send
    await pageA.getByLabel("Email addresses").fill(userBEmail)
    await pageA.getByRole("button", { name: "Send Invitations" }).click()

    // Verify invitation was sent
    await expect(pageA.getByText("Sent 1 invitation")).toBeVisible({ timeout: 5000 })
    await pageA.getByRole("button", { name: "Done" }).click()

    // Verify pending invitation shows in members tab
    await expect(pageA.getByText(userBEmail)).toBeVisible()

    // Capture the workspace URL for verification later
    const workspaceUrl = pageA.url().split("?")[0]

    await contextA.close()

    // ──── User B: Sign in and complete setup ────

    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()

    // Sign in as User B (with the invited email)
    await pageB.goto("/login")
    await pageB.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await expect(pageB.getByRole("heading", { name: "Test Login" })).toBeVisible()
    await pageB.getByLabel("Email").fill(userBEmail)
    await pageB.getByLabel("Name").fill(userBName)
    await pageB.getByRole("button", { name: "Sign In" }).click()

    // Should be redirected to member setup page (auto-accepted invitation)
    await expect(pageB.getByRole("heading", { name: "Welcome" })).toBeVisible({ timeout: 10000 })
    await expect(pageB.getByText("Complete your profile")).toBeVisible()

    // Fill in setup form
    await pageB.getByLabel("Display name").fill(userBName)
    await pageB.getByRole("button", { name: "Complete Setup" }).click()

    // Should land in the workspace — sidebar shows workspace name
    await expect(pageB.getByText(workspaceName)).toBeVisible({ timeout: 10000 })
    await expect(pageB.getByText("Select a stream from the sidebar")).toBeVisible()

    // Switch to All view to see all streams (Smart view may collapse sections)
    await pageB.getByRole("button", { name: "All" }).click()

    // The public channel should be visible in the sidebar
    await expect(pageB.getByText(`#${channelName}`)).toBeVisible({ timeout: 5000 })

    await contextB.close()
  })
})
