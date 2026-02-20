import { test, expect } from "@playwright/test"

/**
 * Tests for thread reply functionality.
 *
 * Tests:
 * 1. Can send a reply in a thread
 * 2. Reply appears in thread panel
 * 3. Thread indicator shows reply count in main stream
 * 4. Can send multiple replies in a thread
 */

test.describe("Thread Replies", () => {
  test.beforeEach(async ({ page }) => {
    const setupId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const testEmail = `thread-test-${setupId}@example.com`
    const testName = `Thread Test ${setupId}`
    const workspaceName = `Thread Test WS ${setupId}`

    // Login and create workspace
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await expect(page.getByRole("heading", { name: "Test Login" })).toBeVisible()

    await page.getByLabel("Email").fill(testEmail)
    await page.getByLabel("Name").fill(testName)
    await page.getByRole("button", { name: "Sign In" }).click()

    // Wait for workspace selection page
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible()

    // Create workspace
    const workspaceInput = page.getByPlaceholder("New workspace name")
    await workspaceInput.fill(workspaceName)
    const createButton = page.getByRole("button", { name: "Create Workspace" })
    await expect(createButton).toBeEnabled()
    await createButton.click()

    // Wait for sidebar to be visible (workspace loaded)
    await expect(page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })
  })

  test("should send a reply in a thread", async ({ page }) => {
    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

    // Create a channel
    const channelName = `thread-reply-${testId}`
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await page.getByRole("dialog").getByPlaceholder("channel-name").fill(channelName)
    await page.waitForTimeout(400)
    await page.getByRole("dialog").getByRole("button", { name: "Create Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Send a parent message in the channel
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent message ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    // Wait for the message to be sent and appear
    await expect(page.getByText(parentMessage)).toBeVisible({ timeout: 5000 })

    // Hover over the message to reveal "Reply in thread" link
    // Scope to main content area to avoid matching sidebar preview
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: parentMessage }).first()
    await messageContainer.hover()

    // Click "Reply in thread" to open thread panel
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    // Wait for thread panel to open - should see "Start a new thread" text
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Verify parent message is visible in the thread panel (use .last() to get the panel instance)
    await expect(page.getByText(parentMessage).last()).toBeVisible()

    // Type a reply in the thread editor (use last editor since there are two now)
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const replyMessage = `Thread reply ${testId}`
    await page.keyboard.type(replyMessage)

    // Send the reply
    await page.keyboard.press("Meta+Enter")

    // Verify the reply appears in the thread panel (scope to panel to avoid sidebar match)
    await expect(page.getByTestId("panel").getByText(replyMessage)).toBeVisible({ timeout: 5000 })

    // Verify author name appears with the reply (use last instance since it's in the panel)
    await expect(page.getByText(/Thread Test /).last()).toBeVisible()
  })

  test("should show reply count in main stream after sending thread reply", async ({ page }) => {
    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

    // Create a channel
    const channelName = `reply-count-${testId}`
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await page.getByRole("dialog").getByPlaceholder("channel-name").fill(channelName)
    await page.waitForTimeout(400)
    await page.getByRole("dialog").getByRole("button", { name: "Create Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Send a parent message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent for count ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(parentMessage)).toBeVisible({ timeout: 5000 })

    // Open thread panel
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: parentMessage }).first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send a reply
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    await page.keyboard.type(`Reply one ${testId}`)
    await page.keyboard.press("Meta+Enter")

    // Wait for reply to be sent (scope to panel to avoid sidebar match)
    await expect(page.getByTestId("panel").getByText(`Reply one ${testId}`)).toBeVisible({ timeout: 5000 })

    // Close the thread panel to see the main stream
    const panel = page.getByTestId("panel")
    await panel.getByRole("button", { name: "Close" }).click()
    await expect(panel).not.toBeVisible({ timeout: 5000 })

    // Verify thread indicator shows "1 reply" on the parent message
    const parentInStream = page.getByRole("main").locator(".group").filter({ hasText: parentMessage }).first()
    await expect(parentInStream).toContainText(parentMessage, { timeout: 10000 })
    await expect(parentInStream).toContainText(/1 reply/i, { timeout: 10000 })
  })

  test("should send multiple replies in a thread", async ({ page }) => {
    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

    // Create a channel
    const channelName = `multi-reply-${testId}`
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await page.getByRole("dialog").getByPlaceholder("channel-name").fill(channelName)
    await page.waitForTimeout(400)
    await page.getByRole("dialog").getByRole("button", { name: "Create Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Send a parent message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent for multiple ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(parentMessage)).toBeVisible({ timeout: 5000 })

    // Open thread
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: parentMessage }).first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send first reply (this creates the thread)
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const reply1 = `First reply ${testId}`
    await page.keyboard.type(reply1)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 5000 })

    // After first reply, panel transitions from draft to real thread
    // Wait for the transition by checking the "Start a new thread" text disappears
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 3000 })

    // Send second reply (get fresh editor reference after transition)
    const threadEditor2 = page.locator("[contenteditable='true']").last()
    await threadEditor2.click()
    const reply2 = `Second reply ${testId}`
    await page.keyboard.type(reply2)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible({ timeout: 5000 })

    // Send third reply
    await threadEditor2.click()
    const reply3 = `Third reply ${testId}`
    await page.keyboard.type(reply3)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply3)).toBeVisible({ timeout: 5000 })

    // All three replies were successfully sent and appeared
    // (verified by the toBeVisible checks after each send above)
  })

  test("should reopen existing thread and send additional reply", async ({ page }) => {
    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

    // Create a channel
    const channelName = `reopen-thread-${testId}`
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await page.getByRole("dialog").getByPlaceholder("channel-name").fill(channelName)
    await page.waitForTimeout(400)
    await page.getByRole("dialog").getByRole("button", { name: "Create Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Send a parent message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent for reopen ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByText(parentMessage)).toBeVisible({ timeout: 5000 })

    // Open thread and send first reply
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: parentMessage }).first()
    await messageContainer.hover()
    let replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const reply1 = `Initial reply ${testId}`
    await page.keyboard.type(reply1)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 5000 })

    // Close the thread panel
    const panel = page.getByTestId("panel")
    await panel.getByRole("button", { name: "Close" }).click()

    // Wait a moment for UI to settle
    await page.waitForTimeout(500)

    // Reopen the thread by clicking the reply count indicator
    const parentInStream = page.getByRole("main").locator(".group").filter({ hasText: parentMessage }).first()
    const threadIndicator = parentInStream.getByText(/1 reply/i)
    await expect(threadIndicator).toBeVisible({ timeout: 3000 })
    await threadIndicator.click()

    // Thread should reopen with existing reply visible
    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 3000 })

    // Send another reply
    await threadEditor.click()
    const reply2 = `Second reply ${testId}`
    await page.keyboard.type(reply2)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible({ timeout: 5000 })

    // Both replies should be visible
    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible()
    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible()

    // Close and verify reply count updated to 2
    await panel.getByRole("button", { name: "Close" }).click()
    await expect(panel).not.toBeVisible({ timeout: 5000 })
    await expect(parentInStream).toContainText(/2 replies/i, { timeout: 10000 })
  })
})
