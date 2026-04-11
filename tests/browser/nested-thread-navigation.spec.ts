import { test, expect, type Page } from "@playwright/test"
import {
  clickReplyInThread,
  createChannel,
  expectApiOk,
  generateTestId,
  loginAndCreateWorkspace,
  sendPanelReply,
  waitForRealThreadPanel,
} from "./helpers"

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
  async function sendChannelMessageViaApi(page: Page, text: string): Promise<void> {
    const match = page.url().match(/\/w\/([^/]+)\/s\/([^/?]+)/)
    expect(match).toBeTruthy()
    const [, workspaceId, streamId] = match!

    const response = await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
      data: {
        streamId,
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
        contentMarkdown: text,
      },
    })
    await expectApiOk(response, `Create stream message: ${text}`)
  }

  test.beforeEach(async ({ page }) => {
    await loginAndCreateWorkspace(page, "nested-thread")
  })

  test("should show nested thread reply count when navigating back via breadcrumbs", async ({ page }) => {
    test.setTimeout(90000)
    const testId = generateTestId()

    // Create a channel (creating navigates to it)
    const channelName = `nested-breadcrumb-${testId}`
    await createChannel(page, channelName)

    // Post a message in the channel
    const channelMessage = `Channel message ${testId}`
    await sendChannelMessageViaApi(page, channelMessage)

    await expect(
      page.getByRole("main").locator(".message-item").filter({ hasText: channelMessage }).first()
    ).toBeVisible({
      timeout: 5000,
    })

    // Start a first-level thread by replying to the channel message
    const messageContainer = page.getByRole("main").locator(".message-item").filter({ hasText: channelMessage }).first()
    await clickReplyInThread(messageContainer)

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send first-level thread reply
    const firstReply = `First level reply ${testId}`
    await sendPanelReply(page, firstReply)

    // Scope to thread panel to avoid matching hidden sidebar/breadcrumb text
    await expect(page.getByTestId("panel").getByText(firstReply)).toBeVisible({ timeout: 5000 })

    // Wait for thread to be created (draft transitions to real thread)
    await waitForRealThreadPanel(page)

    // Now reply to the first-level thread reply to create a nested (second-level) thread
    const firstReplyContainer = page
      .getByTestId("panel")
      .locator(".message-item")
      .filter({ hasText: firstReply })
      .first()
    await clickReplyInThread(firstReplyContainer)

    // Wait for nested thread draft panel to appear
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send nested thread reply
    const nestedReply = `Nested thread reply ${testId}`
    await sendPanelReply(page, nestedReply)

    await expect(page.getByTestId("panel").getByText(nestedReply)).toBeVisible({ timeout: 5000 })

    // Wait for nested thread to be created
    await waitForRealThreadPanel(page)

    // Navigate back to the first-level thread via breadcrumbs
    // The breadcrumb should show the parent thread (which contains firstReply)
    // Target the breadcrumb in the thread panel header (not sidebar navigation)
    const breadcrumb = page.locator("nav[aria-label='breadcrumb'] a").first()
    await expect(breadcrumb).toBeVisible({ timeout: 2000 })
    await breadcrumb.click()

    // Verify we're back in the first-level thread by checking for the firstReply message
    await expect(page.getByTestId("panel").getByText(firstReply).first()).toBeVisible({ timeout: 5000 })

    // CRITICAL: The firstReply message should show as having 1 reply (the nested thread)
    // This is the bug - it doesn't show the reply count after navigating back
    const firstReplyInPanel = page.getByTestId("panel").locator(".message-item").filter({ hasText: firstReply }).first()
    await expect(firstReplyInPanel).toContainText(/1 reply/i, { timeout: 45000 })
  })

  test("should show nested thread indicator when reopening parent thread", async ({ page }) => {
    test.setTimeout(90000)
    const testId = generateTestId()

    // Create a channel (creating navigates to it)
    const channelName = `nested-reopen-${testId}`
    await createChannel(page, channelName)

    // Post a message in the channel
    const channelMessage = `Channel post ${testId}`
    await sendChannelMessageViaApi(page, channelMessage)

    await expect(
      page.getByRole("main").locator(".message-item").filter({ hasText: channelMessage }).first()
    ).toBeVisible({
      timeout: 5000,
    })

    // Start a thread on the channel message
    const messageContainer = page.getByRole("main").locator(".message-item").filter({ hasText: channelMessage }).first()
    await clickReplyInThread(messageContainer)

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send thread reply
    const threadReply = `Thread reply ${testId}`
    await sendPanelReply(page, threadReply)

    await expect(page.getByTestId("panel").getByText(threadReply)).toBeVisible({ timeout: 5000 })
    await waitForRealThreadPanel(page)

    // Reply to the thread reply to create a nested thread
    const threadReplyContainer = page
      .getByTestId("panel")
      .locator(".message-item")
      .filter({ hasText: threadReply })
      .first()
    await clickReplyInThread(threadReplyContainer)

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Send nested reply
    const nestedReply = `Nested reply ${testId}`
    await sendPanelReply(page, nestedReply)

    await expect(page.getByTestId("panel").getByText(nestedReply)).toBeVisible({ timeout: 5000 })
    await waitForRealThreadPanel(page)

    // Return to the main stream via the breadcrumb. This exercises the same
    // navigation path as a user re-opening the thread from the parent message,
    // without depending on the close-button click animation settling first.
    const returnToChannel = page.getByRole("button", { name: `Return to #${channelName}` })
    await expect(returnToChannel).toBeVisible({ timeout: 5000 })
    await returnToChannel.click()
    await expect(page).not.toHaveURL(/panel=/)

    // Reopen the first-level thread by clicking on the reply count in the main stream
    const channelMessageInMain = page
      .getByRole("main")
      .locator(".message-item")
      .filter({ hasText: channelMessage })
      .first()
    const threadIndicator = channelMessageInMain.getByText(/1 reply/i)
    await expect(threadIndicator).toBeVisible({ timeout: 3000 })
    await threadIndicator.click()

    // Thread should reopen and show the threadReply. Bootstrap refetch is
    // triggered by useStreamSocket on re-mount, which includes updated reply counts.
    await expect(page.getByTestId("panel").getByText(threadReply)).toBeVisible({ timeout: 10000 })

    // CRITICAL: The threadReply message should show as having a nested thread (1 reply).
    // The reply count arrives via bootstrap refetch after the stream socket re-subscribes.
    const threadReplyInPanel = page
      .getByTestId("panel")
      .locator(".message-item")
      .filter({ hasText: threadReply })
      .first()
    await expect
      .poll(async () => (await threadReplyInPanel.textContent()) ?? "", { timeout: 45000 })
      .toMatch(/1 reply/i)
  })

  test("should maintain reply counts across multiple navigation cycles", async ({ page }) => {
    const testId = generateTestId()

    test.setTimeout(90000)

    // Create a channel (creating navigates to it)
    const channelName = `nav-cycles-${testId}`
    await createChannel(page, channelName)

    // Post in channel
    const rootMessage = `Root ${testId}`
    await sendChannelMessageViaApi(page, rootMessage)
    await expect(page.getByRole("main").locator(".message-item").filter({ hasText: rootMessage }).first()).toBeVisible({
      timeout: 5000,
    })

    // Create first-level thread
    const rootContainer = page.getByRole("main").locator(".message-item").filter({ hasText: rootMessage }).first()
    await clickReplyInThread(rootContainer)
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    const level1Message = `Level 1 ${testId}`
    await sendPanelReply(page, level1Message)
    await expect(page.getByTestId("panel").getByText(level1Message)).toBeVisible({ timeout: 10000 })
    await waitForRealThreadPanel(page)

    // Create nested thread
    const level1Container = page
      .getByTestId("panel")
      .locator(".message-item")
      .filter({ hasText: level1Message })
      .first()
    await clickReplyInThread(level1Container)
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    const level2Message = `Level 2 ${testId}`
    await sendPanelReply(page, level2Message)
    await waitForRealThreadPanel(page)
    await expect(page.getByTestId("panel").getByText(level2Message)).toBeVisible({ timeout: 10000 })

    // Navigate back via breadcrumb — bootstrap refetch delivers updated reply counts
    const breadcrumb = page.locator("nav[aria-label='breadcrumb'] a").first()
    await breadcrumb.click()

    // Verify reply count shows (bootstrap refetch may take a moment in CI)
    const level1InPanel = page.getByTestId("panel").locator(".message-item").filter({ hasText: level1Message }).first()
    await expect(level1InPanel).toContainText(/1 reply/i, { timeout: 20000 })

    // Navigate forward again by clicking the reply count
    await level1InPanel.getByText(/1 reply/i).click()
    await expect(page.getByTestId("panel").getByText(level2Message)).toBeVisible({ timeout: 10000 })

    // Navigate back again
    await breadcrumb.click()

    // Reply count should still show correctly
    await expect(level1InPanel).toContainText(/1 reply/i, { timeout: 20000 })
  })
})
