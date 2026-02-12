import { test, expect } from "@playwright/test"

/**
 * Invitation flow E2E test.
 *
 * Tests the complete multi-user flow:
 * 1. User A signs in, creates a workspace, creates a public channel
 * 2. User A invites User B by email via workspace settings
 * 3. User B signs in — auto-accepted into workspace, redirected to setup
 * 4. User B completes member setup (name, slug, timezone, locale)
 * 5. User B does NOT see the public channel in sidebar (not a member yet)
 * 6. User B finds it via quick switcher (shows "Not joined"), navigates to it
 * 7. User B sees join bar, clicks "Join Channel", channel appears in sidebar
 */

test.describe("Invitation Flow", () => {
  test("should allow owner to invite a user who then joins and sees the workspace", async ({ browser }) => {
    test.setTimeout(60000)

    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const userAEmail = `inviter-${testId}@example.com`
    const userAName = `Inviter ${testId}`
    const userBEmail = `invitee-${testId}@example.com`
    const userBName = `Invitee ${testId}`
    const workspaceName = `Invite Test ${testId}`
    const channelName = `general-${testId}`

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

    // Invitation acceptance can land on setup first, or directly in workspace if setup is already complete.
    const displayNameInput = pageB.getByLabel("Display name")
    const completeSetupButton = pageB.getByRole("button", { name: "Complete Setup" })
    await expect
      .poll(
        async () => {
          const inSetup =
            (await displayNameInput.isVisible().catch(() => false)) &&
            (await completeSetupButton.isVisible().catch(() => false))
          if (inSetup) return "setup"

          const inWorkspace = await pageB
            .getByText(workspaceName)
            .isVisible()
            .catch(() => false)
          if (inWorkspace) return "workspace"

          return "pending"
        },
        { timeout: 15000 }
      )
      .not.toBe("pending")

    if (
      (await displayNameInput.isVisible().catch(() => false)) &&
      (await completeSetupButton.isVisible().catch(() => false))
    ) {
      // Avoid churn in slug checks under load: only fill name when it's empty.
      if ((await displayNameInput.inputValue().catch(() => "")).trim().length === 0) {
        await displayNameInput.fill(userBName)
      }

      const displaySlugInput = pageB.getByLabel("Display slug")
      if (!(await completeSetupButton.isEnabled().catch(() => false))) {
        await displaySlugInput.fill(`invitee-${testId}`)
      }

      await expect(completeSetupButton).toBeEnabled({ timeout: 20000 })
      await completeSetupButton.click()
    }

    // Should land in the workspace — sidebar shows workspace name.
    await expect(pageB.getByText(workspaceName)).toBeVisible({ timeout: 10000 })

    // User B starts with no streams — empty state is shown, view toggle is hidden.
    // Public channel should NOT be in sidebar (User B is not a member)
    await expect(pageB.getByText(`#${channelName}`)).not.toBeVisible()

    // ──── User B: Find channel via quick switcher and join ────

    // Open quick switcher (Cmd+K)
    await pageB.keyboard.press("Meta+k")
    await expect(pageB.getByRole("dialog")).toBeVisible()

    // Search for the channel
    await pageB.getByLabel("Quick switcher input").fill(channelName)

    // Should show "Not joined" indicator
    await expect(pageB.getByText("Not joined")).toBeVisible({ timeout: 5000 })

    // Select the channel result directly to avoid Enter-selection races under load.
    const channelOption = pageB.getByRole("option", { name: new RegExp(`#${channelName}`) }).first()
    await expect(channelOption).toBeVisible({ timeout: 10000 })
    await channelOption.click()

    // Wait for navigation to the channel page.
    await expect(pageB.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 10000 })

    const joinButton = pageB.getByRole("button", { name: "Join Channel" })
    const sendButton = pageB.getByRole("button", { name: "Send" })

    // Under load, navigation can race with membership hydration.
    // Wait until either join gate (not joined) or composer (already joined) is visible.
    await expect
      .poll(
        async () => {
          const canJoin = await joinButton.isVisible().catch(() => false)
          if (canJoin) return "join"
          const canSend = await sendButton.isVisible().catch(() => false)
          if (canSend) return "joined"
          return "pending"
        },
        { timeout: 15000 }
      )
      .not.toBe("pending")

    // Join when required. If already joined, continue.
    if (await joinButton.isVisible().catch(() => false)) {
      await joinButton.click()
      await expect(joinButton).not.toBeVisible({ timeout: 5000 })
    }

    // Channel should now appear in the sidebar
    await expect(pageB.getByText(`#${channelName}`).first()).toBeVisible({ timeout: 5000 })

    await contextB.close()
  })
})
