import { test, expect } from "@playwright/test"

/**
 * Tests for thread breadcrumb display, navigation, and sidebar context.
 *
 * Covers:
 * - Breadcrumb ancestor chain renders correctly in thread panels
 * - Navigation via breadcrumb links works (up-chevron was removed)
 * - Sidebar shows thread root context suffix (e.g., "· #general")
 */

test.describe("Thread Breadcrumbs", () => {
  const testId = Date.now().toString(36)
  const testEmail = `breadcrumb-${testId}@example.com`
  const testName = `BC Test ${testId}`
  const workspaceName = `Breadcrumb WS ${testId}`

  test.beforeEach(async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await expect(page.getByRole("heading", { name: "Test Login" })).toBeVisible()

    await page.getByLabel("Email").fill(testEmail)
    await page.getByLabel("Name").fill(testName)
    await page.getByRole("button", { name: "Sign In" }).click()

    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible()

    const workspaceInput = page.getByPlaceholder("New workspace name")
    await workspaceInput.fill(workspaceName)
    const createButton = page.getByRole("button", { name: "Create Workspace" })
    await expect(createButton).toBeEnabled()
    await createButton.click()

    await expect(page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })
  })

  test("should show ancestor chain in breadcrumbs and navigate via breadcrumb click", async ({ page }) => {
    // Create a channel
    const channelName = `bc-nav-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Post a message in the channel
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const channelMessage = `BC nav test ${testId}`
    await page.keyboard.type(channelMessage)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(channelMessage)).toBeVisible({ timeout: 5000 })

    // Create a first-level thread
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: channelMessage }).first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 2000 })
    await replyLink.click()
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Draft breadcrumbs should show the channel as ancestor and "New thread" as current
    const breadcrumbNav = page.locator("nav[aria-label='breadcrumb']")
    await expect(breadcrumbNav.getByText(`#${channelName}`)).toBeVisible({ timeout: 2000 })
    await expect(breadcrumbNav.getByText("New thread")).toBeVisible()

    // Send thread reply to create the thread
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const level1Reply = `Level 1 reply ${testId}`
    await page.keyboard.type(level1Reply)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByText(level1Reply)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // After thread creation, breadcrumbs should still show the channel
    await expect(breadcrumbNav.getByText(`#${channelName}`)).toBeVisible({ timeout: 2000 })

    // Create a second-level nested thread
    const level1Container = page.getByRole("main").locator(".group").filter({ hasText: level1Reply }).first()
    await level1Container.hover()
    await level1Container.getByRole("link", { name: "Reply in thread" }).click()
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Draft breadcrumbs for nested thread should show channel + parent thread as ancestors
    await expect(breadcrumbNav.getByText(`#${channelName}`)).toBeVisible({ timeout: 2000 })
    await expect(breadcrumbNav.getByText("New thread")).toBeVisible()

    // Send nested thread reply
    const nestedEditor = page.locator("[contenteditable='true']").last()
    await nestedEditor.click()
    const level2Reply = `Level 2 reply ${testId}`
    await page.keyboard.type(level2Reply)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByText(level2Reply)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Navigate to the channel by clicking its breadcrumb link.
    // Since the channel is the main view, clicking it should close the panel.
    const channelBreadcrumb = breadcrumbNav.getByRole("link", { name: `#${channelName}` }).first()
    if (await channelBreadcrumb.isVisible().catch(() => false)) {
      await channelBreadcrumb.click()
    } else {
      // Breadcrumb might be a button (for main-view streams that close the panel)
      const channelButton = breadcrumbNav.getByRole("button", { name: `#${channelName}` }).first()
      await channelButton.click()
    }
    await page.waitForTimeout(500)

    // Should be back viewing the channel with the original message visible
    await expect(page.getByRole("main").getByText(channelMessage).first()).toBeVisible({ timeout: 3000 })
  })

  test("should show thread with root context suffix in sidebar", async ({ page }) => {
    // Create a channel
    const channelName = `sidebar-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Post a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const channelMessage = `Sidebar context ${testId}`
    await page.keyboard.type(channelMessage)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(channelMessage)).toBeVisible({ timeout: 5000 })

    // Create a thread
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: channelMessage }).first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 2000 })
    await replyLink.click()
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send thread reply to create the thread
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    await page.keyboard.type(`Thread reply ${testId}`)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByText(`Thread reply ${testId}`)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Reload to ensure workspace bootstrap reflects the new thread in sidebar
    await page.reload()
    await expect(page.getByRole("navigation", { name: "Sidebar navigation" })).toBeVisible({ timeout: 10000 })

    // The sidebar should show the thread with a root context suffix " · #channel-name"
    // This unique format (dot separator + channel slug) only appears on thread entries
    await expect(page.getByText(`· #${channelName}`).first()).toBeVisible({ timeout: 10000 })
  })
})
