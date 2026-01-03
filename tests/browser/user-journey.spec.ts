import { test, expect } from "@playwright/test"

/**
 * Full user journey E2E test.
 *
 * Tests the complete flow:
 * 1. New user logs in via stub auth
 * 2. Creates a workspace
 * 3. Creates a channel
 * 4. Sends a message
 */

test.describe("User Journey", () => {
  // Generate unique identifiers for this test run
  const testId = Date.now().toString(36)
  const testEmail = `e2e-${testId}@example.com`
  const testName = `E2E User ${testId}`
  const workspaceName = `E2E Workspace ${testId}`
  const channelName = `test-${testId}`

  test("complete user journey: login, create workspace, create channel, send message", async ({ page }) => {
    // Step 1: Navigate to login page
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Threa" })).toBeVisible()

    // Step 2: Click sign in - should redirect to stub auth page
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()

    // Step 3: Should be on the fake login page
    await expect(page.getByRole("heading", { name: "Test Login" })).toBeVisible()
    await expect(page.getByText("Stub auth enabled")).toBeVisible()

    // Step 4: Fill in custom credentials and submit
    await page.getByLabel("Email").fill(testEmail)
    await page.getByLabel("Name").fill(testName)
    await page.getByRole("button", { name: "Sign In" }).click()

    // Step 5: Should land on workspace selection (new user has no workspaces)
    await expect(page.getByRole("heading", { name: `Welcome, ${testName}` })).toBeVisible()
    await expect(page.getByPlaceholder("New workspace name")).toBeVisible()

    // Step 6: Create a workspace
    await page.getByPlaceholder("New workspace name").fill(workspaceName)
    await page.getByRole("button", { name: "Create Workspace" }).click()

    // Step 7: Should enter the workspace - verify sidebar is visible
    await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Channels", level: 3 })).toBeVisible()

    // Step 8: Set up dialog handler BEFORE clicking (dialog appears synchronously)
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt")
      expect(dialog.message()).toBe("Channel name:")
      await dialog.accept(channelName)
    })

    // Step 9: Create a channel - this triggers the dialog
    await page.getByRole("button", { name: "+ New Channel" }).click()

    // Wait for the channel to appear in sidebar
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Step 10: Verify we're in the channel view
    await expect(page.getByText("No messages yet")).toBeVisible()

    // Step 11: Send a message (rich text editor uses contenteditable, not input)
    const messageContent = `Hello from E2E test! ${testId}`
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.type(messageContent)

    // Step 12: Click Send button
    await page.getByRole("button", { name: "Send" }).click()

    // Step 13: Verify message appears
    await expect(page.getByText(messageContent)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(testName)).toBeVisible() // Author name
  })

  test("preset login buttons work", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()

    // Click Alice Anderson preset button
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    // Should be redirected and logged in as Alice
    await expect(page.getByRole("heading", { name: "Welcome, Alice Anderson" })).toBeVisible()
  })

  test("can navigate between scratchpads and channels", async ({ page }) => {
    // Login as Alice (who may already have workspaces from previous tests)
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    // Wait for workspace page
    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    // If on workspace selection, create one
    const createButton = page.getByRole("button", { name: "Create Workspace" })
    if (await createButton.isDisabled()) {
      await page.getByPlaceholder("New workspace name").fill(`Nav Test ${testId}`)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    // Now in workspace - create a scratchpad
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()

    // Should navigate to the scratchpad
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })
  })
})
