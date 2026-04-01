import { test, expect } from "@playwright/test"
import { createChannel, loginAndCreateWorkspace } from "./helpers"

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
  let testId: string

  test.beforeEach(async ({ page }) => {
    const result = await loginAndCreateWorkspace(page, "thread-test")
    testId = result.testId
  })

  test("should send a reply in a thread", async ({ page }) => {
    // Create a channel
    const channelName = `thread-reply-${testId}`
    await createChannel(page, channelName)

    // Send a parent message in the channel
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent message ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    // Wait for the message to be sent and appear
    // Scope to .message-item to avoid matching sidebar preview text
    const messageContainer = page.getByRole("main").locator(".message-item").filter({ hasText: parentMessage }).first()
    await expect(messageContainer).toBeVisible({ timeout: 5000 })
    await messageContainer.hover()

    // Click "Reply in thread" to open thread panel
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    // Wait for thread panel to open - should see "Start a new thread" text
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Verify parent message is visible in the thread panel
    await expect(page.getByTestId("panel").getByText(parentMessage)).toBeVisible()

    // Type a reply in the thread editor (use last editor since there are two now)
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const replyMessage = `Thread reply ${testId}`
    await page.keyboard.type(replyMessage)

    // Send the reply
    await page.keyboard.press("Meta+Enter")

    // Verify the reply appears in the thread panel (scope to panel to avoid sidebar match)
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("panel").getByText(replyMessage)).toBeVisible({ timeout: 10000 })

    // Verify author name appears with the reply (use last instance since it's in the panel)
    await expect(page.getByText(/thread-test/i).last()).toBeVisible()
  })

  test("should show reply count in main stream after sending thread reply", async ({ page }) => {
    // Create a channel
    const channelName = `reply-count-${testId}`
    await createChannel(page, channelName)

    // Send a parent message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent for count ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    // Scope to .message-item to avoid matching sidebar preview text
    const messageContainer = page.getByRole("main").locator(".message-item").filter({ hasText: parentMessage }).first()
    await expect(messageContainer).toBeVisible({ timeout: 5000 })

    // Open thread panel
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

    // Close the thread panel to see the main stream
    const panel = page.getByTestId("panel")
    await panel.getByRole("button", { name: "Close" }).click()

    // Verify thread indicator shows "1 reply" on the parent message
    const parentInStream = page.getByRole("main").locator(".message-item").filter({ hasText: parentMessage }).first()
    await expect(parentInStream).toContainText(parentMessage, { timeout: 10000 })
    await expect(parentInStream).toContainText(/1 reply/i, { timeout: 10000 })
  })

  test("should send multiple replies in a thread", async ({ page }) => {
    // Create a channel
    const channelName = `multi-reply-${testId}`
    await createChannel(page, channelName)

    // Send a parent message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent for multiple ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    // Scope to .message-item to avoid matching sidebar preview text
    const messageContainer = page.getByRole("main").locator(".message-item").filter({ hasText: parentMessage }).first()
    await expect(messageContainer).toBeVisible({ timeout: 5000 })

    // Open thread
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

    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 10000 })

    // After first reply, panel transitions from draft to real thread.
    // Wait for the transition to complete before interacting with the editor.
    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 10000 })

    // Get fresh editor reference after the draft→thread transition
    const threadEditor2 = page.locator("[contenteditable='true']").last()
    await threadEditor2.click()
    const reply2 = `Second reply ${testId}`
    await page.keyboard.type(reply2)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible({ timeout: 10000 })

    // Send third reply
    await threadEditor2.click()
    const reply3 = `Third reply ${testId}`
    await page.keyboard.type(reply3)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply3)).toBeVisible({ timeout: 10000 })

    // All three replies were successfully sent and appeared
    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("panel").getByText(reply3)).toBeVisible({ timeout: 10000 })
  })

  test("should reopen existing thread and send additional reply", async ({ page }) => {
    // Create a channel
    const channelName = `reopen-thread-${testId}`
    await createChannel(page, channelName)

    // Send a parent message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const parentMessage = `Parent for reopen ${testId}`
    await page.keyboard.type(parentMessage)
    await page.keyboard.press("Meta+Enter")

    // Scope to .message-item to avoid matching sidebar preview text
    const messageContainer = page.getByRole("main").locator(".message-item").filter({ hasText: parentMessage }).first()
    await expect(messageContainer).toBeVisible({ timeout: 5000 })

    // Open thread and send first reply
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

    await expect(page.getByText(/Start a new thread/)).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 10000 })

    // Close the thread panel
    const panel = page.getByTestId("panel")
    await panel.getByRole("button", { name: "Close" }).click()
    await expect(panel).not.toBeVisible({ timeout: 5000 })

    // Reopen the thread by clicking the reply count indicator
    const parentInStream = page.getByRole("main").locator(".message-item").filter({ hasText: parentMessage }).first()
    const threadIndicator = parentInStream.getByText(/1 reply/i)
    await expect(threadIndicator).toBeVisible({ timeout: 3000 })
    await threadIndicator.click()

    // Thread should reopen with existing reply visible
    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible({ timeout: 10000 })

    // Send another reply
    await threadEditor.click()
    const reply2 = `Second reply ${testId}`
    await page.keyboard.type(reply2)
    await page.keyboard.press("Meta+Enter")

    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible({ timeout: 10000 })

    // Both replies should be visible
    await expect(page.getByTestId("panel").getByText(reply1)).toBeVisible()
    await expect(page.getByTestId("panel").getByText(reply2)).toBeVisible()

    // Close and verify reply count updated to 2
    await panel.getByRole("button", { name: "Close" }).click()
    await expect(panel).not.toBeVisible({ timeout: 5000 })
    await expect(parentInStream).toContainText(/2 replies/i, { timeout: 10000 })
  })
})
