import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, generateTestId } from "./helpers"

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
  test("should allow new user to sign in, create workspace, create channel, and send message", async ({ page }) => {
    // Generate unique identifiers for this test run
    const testId = generateTestId()
    const testEmail = `e2e-${testId}@example.com`
    const testName = `E2E User ${testId}`
    const workspaceName = `E2E Workspace ${testId}`
    const channelName = `test-${testId}`

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

    // Step 7: Should enter the workspace - verify sidebar is visible (empty state shows buttons)
    await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible()
    await expect(page.getByRole("button", { name: "+ New Channel" })).toBeVisible()

    // Step 8: Set up dialog handler BEFORE clicking (dialog appears synchronously)
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt")
      expect(dialog.message()).toBe("Channel name:")
      await dialog.accept(channelName)
    })

    // Step 9: Create a channel - this triggers the dialog and navigates to the channel
    await page.getByRole("button", { name: "+ New Channel" }).click()

    // Step 10: Verify we're in the channel view (channel heading and empty state)
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText("No messages yet")).toBeVisible()

    // Step 11: Send a message (rich text editor uses contenteditable, not input)
    const messageContent = `Hello from E2E test! ${testId}`
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.type(messageContent)

    // Step 12: Click Send button
    await page.getByRole("button", { name: "Send" }).click()

    // Step 13: Verify message appears
    await expect(page.getByText(messageContent)).toBeVisible({ timeout: 5000 })
  })

  test("should authenticate new user and show welcome page", async ({ page }) => {
    const testId = generateTestId()
    const testEmail = `preset-${testId}@example.com`
    const testName = `Preset User ${testId}`

    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()

    // Fill in custom credentials
    await page.getByLabel("Email").fill(testEmail)
    await page.getByLabel("Name").fill(testName)
    await page.getByRole("button", { name: "Sign In" }).click()

    // Should be redirected and logged in — new user sees welcome page
    await expect(page.getByRole("heading", { name: `Welcome, ${testName}` })).toBeVisible()
  })

  test("should create and navigate to new scratchpad", async ({ page }) => {
    await loginAndCreateWorkspace(page, "nav")

    // Now in workspace - create a scratchpad
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()

    // Should navigate to the scratchpad
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })
  })

  test("should navigate to channel when using quick switcher search", async ({ page }) => {
    const { testId } = await loginAndCreateWorkspace(page, "quickswitch")

    // Create a channel with a unique name we can search for
    const quickSwitchChannel = `qs-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(quickSwitchChannel)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()

    // Creating a channel navigates to it - verify via main content heading
    await expect(page.getByRole("heading", { name: `#${quickSwitchChannel}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Switch to All view to access the "+ New Scratchpad" button (not visible in Smart view with content)
    await page.getByRole("button", { name: "All" }).click()
    await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible({ timeout: 5000 })

    // Create a scratchpad to navigate away from the channel
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Now test the quick switcher - open with Cmd+K (Meta+K on Mac)
    await page.keyboard.press("Meta+k")

    // Quick switcher dialog should appear - look for the mode tabs as indicator
    await expect(page.getByText("Stream search")).toBeVisible({ timeout: 2000 })

    // Type the channel name to search (focus should already be in the input)
    await page.keyboard.type(quickSwitchChannel)

    // Wait a moment for search results to appear, then press Enter to select
    await page.waitForTimeout(500)
    await page.keyboard.press("Enter")

    // Should navigate to the channel (quick switcher closes)
    await expect(page.getByText("Stream search")).not.toBeVisible({ timeout: 2000 })

    // Verify we're in the channel by checking the URL or channel content
    await expect(page.getByText("No messages yet")).toBeVisible({ timeout: 5000 })
  })
})
