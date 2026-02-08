import { test, expect } from "@playwright/test"

/**
 * Tests for nested thread navigation and bootstrapping.
 *
 * These tests verify that when navigating between thread levels,
 * the thread state is properly bootstrapped with correct reply counts.
 *
 * Critical bug: Navigating back to parent threads via breadcrumbs or
 * reopening threads does not properly show nested thread reply counts.
 */

test.describe("Nested Thread Navigation", () => {
  const testId = Date.now().toString(36)
  const testEmail = `nested-thread-${testId}@example.com`
  const testName = `Nested Test ${testId}`
  const workspaceName = `Nested Thread WS ${testId}`

  test.beforeEach(async ({ page }) => {
    // Login and create workspace
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

  test("should show nested thread reply count when navigating back via breadcrumbs", async ({ page }) => {
    // Create a channel (creating navigates to it)
    const channelName = `nested-breadcrumb-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Post a message in the channel
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const channelMessage = `Channel message ${testId}`
    await page.keyboard.type(channelMessage)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(channelMessage)).toBeVisible({ timeout: 5000 })

    // Start a first-level thread by replying to the channel message
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: channelMessage }).first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 2000 })
    await replyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send first-level thread reply
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const firstReply = `First level reply ${testId}`
    await page.keyboard.type(firstReply)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(firstReply)).toBeVisible({ timeout: 5000 })

    // Wait for thread to be created (draft transitions to real thread)
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Now reply to the first-level thread reply to create a nested (second-level) thread
    const firstReplyContainer = page.getByRole("main").locator(".group").filter({ hasText: firstReply }).first()
    await firstReplyContainer.hover()
    const nestedReplyLink = firstReplyContainer.getByRole("link", { name: "Reply in thread" })
    await expect(nestedReplyLink).toBeVisible({ timeout: 2000 })
    await nestedReplyLink.click()

    // Wait for nested thread draft panel to appear
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send nested thread reply
    const nestedThreadEditor = page.locator("[contenteditable='true']").last()
    await nestedThreadEditor.click()
    const nestedReply = `Nested thread reply ${testId}`
    await page.keyboard.type(nestedReply)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(nestedReply)).toBeVisible({ timeout: 5000 })

    // Wait for nested thread to be created
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Navigate back to the first-level thread via breadcrumbs
    // The breadcrumb should show the parent thread (which contains firstReply)
    // Target the breadcrumb in the thread panel header (not sidebar navigation)
    const breadcrumb = page.locator("nav[aria-label='breadcrumb'] a").first()
    await expect(breadcrumb).toBeVisible({ timeout: 2000 })
    await breadcrumb.click()

    // Wait for navigation to complete
    await page.waitForTimeout(1000)

    // Verify we're back in the first-level thread by checking for the firstReply message
    await expect(page.getByText(firstReply).first()).toBeVisible({ timeout: 5000 })

    // CRITICAL: The firstReply message should show as having 1 reply (the nested thread)
    // This is the bug - it doesn't show the reply count after navigating back
    const firstReplyInPanel = page.getByRole("main").locator(".group").filter({ hasText: firstReply }).first()
    await expect(firstReplyInPanel.getByText(/1 reply/i)).toBeVisible({ timeout: 3000 })
  })

  test("should show nested thread indicator when reopening parent thread", async ({ page }) => {
    // Create a channel (creating navigates to it)
    const channelName = `nested-reopen-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Post a message in the channel
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const channelMessage = `Channel post ${testId}`
    await page.keyboard.type(channelMessage)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(channelMessage)).toBeVisible({ timeout: 5000 })

    // Start a thread on the channel message
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: channelMessage }).first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 2000 })
    await replyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send thread reply
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const threadReply = `Thread reply ${testId}`
    await page.keyboard.type(threadReply)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(threadReply)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Reply to the thread reply to create a nested thread
    const threadReplyContainer = page.getByRole("main").locator(".group").filter({ hasText: threadReply }).first()
    await threadReplyContainer.hover()
    const nestedReplyLink = threadReplyContainer.getByRole("link", { name: "Reply in thread" })
    await expect(nestedReplyLink).toBeVisible({ timeout: 2000 })
    await nestedReplyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send nested reply
    const nestedEditor = page.locator("[contenteditable='true']").last()
    await nestedEditor.click()
    const nestedReply = `Nested reply ${testId}`
    await page.keyboard.type(nestedReply)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(nestedReply)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Close the thread panel
    await page.keyboard.press("Escape")

    // Wait for panel to close
    await page.waitForTimeout(500)

    // Reopen the first-level thread by clicking on the reply count in the main stream
    const channelMessageInMain = page.getByRole("main").locator(".group").filter({ hasText: channelMessage }).first()
    const threadIndicator = channelMessageInMain.getByText(/1 reply/i)
    await expect(threadIndicator).toBeVisible({ timeout: 3000 })
    await threadIndicator.click()

    // Thread should reopen and show the threadReply
    await expect(page.getByText(threadReply).first()).toBeVisible({ timeout: 3000 })

    // CRITICAL: The threadReply message should show as having a nested thread (1 reply)
    // This is the bug - it doesn't show the reply indicator after reopening
    const threadReplyInPanel = page.getByRole("main").locator(".group").filter({ hasText: threadReply }).first()
    await expect(threadReplyInPanel.getByText(/1 reply/i)).toBeVisible({ timeout: 3000 })
  })

  test("should maintain reply counts across multiple navigation cycles", async ({ page }) => {
    // Create a channel (creating navigates to it)
    const channelName = `nav-cycles-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Post in channel
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const rootMessage = `Root ${testId}`
    await page.keyboard.type(rootMessage)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByText(rootMessage)).toBeVisible({ timeout: 5000 })

    // Create first-level thread
    const rootContainer = page.getByRole("main").locator(".group").filter({ hasText: rootMessage }).first()
    await rootContainer.hover()
    await rootContainer.getByRole("link", { name: "Reply in thread" }).click()
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const level1Message = `Level 1 ${testId}`
    await page.keyboard.type(level1Message)
    await page.keyboard.press("Meta+Enter")
    const level1Container = page.getByRole("main").locator(".group").filter({ hasText: level1Message }).first()
    await expect(level1Container).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Create nested thread
    await level1Container.hover()
    await level1Container.getByRole("link", { name: "Reply in thread" }).click()
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    const nestedEditor = page.locator("[contenteditable='true']").last()
    await nestedEditor.click()
    const level2Message = `Level 2 ${testId}`
    await page.keyboard.type(level2Message)
    await page.keyboard.press("Meta+Enter")
    const level2InPanel = page.getByRole("main").locator(".group").filter({ hasText: level2Message }).first()
    await expect(level2InPanel).toBeVisible({ timeout: 5000 })

    // Navigate back via breadcrumb
    const breadcrumb = page.locator("nav[aria-label='breadcrumb'] a").first()
    await breadcrumb.click()
    await page.waitForTimeout(1000)

    // Verify reply count shows
    const level1InPanel = page.getByRole("main").locator(".group").filter({ hasText: level1Message }).first()
    await expect(level1InPanel.getByText(/1 reply/i)).toBeVisible({ timeout: 3000 })

    // Navigate forward again by clicking the reply count
    await level1InPanel.getByText(/1 reply/i).click()
    await expect(level2InPanel).toBeVisible({ timeout: 3000 })

    // Navigate back again
    await breadcrumb.click()
    await page.waitForTimeout(1000)

    // Reply count should still show correctly
    await expect(level1InPanel.getByText(/1 reply/i)).toBeVisible({ timeout: 3000 })
  })
})
