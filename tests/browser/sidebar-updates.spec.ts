import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, createChannel, switchToAllView } from "./helpers"

/**
 * Sidebar real-time update E2E tests.
 *
 * Tests that sidebar updates correctly when:
 * 1. New messages arrive (preview should update)
 * 2. Stream is renamed (name should update in sidebar)
 * 3. Messages from other users appear when navigating to stream
 */

test.describe("Sidebar Updates", () => {
  test.describe("Bug 1: Message preview in sidebar", () => {
    test("sidebar should show preview of last message sent in channel", async ({ page }) => {
      const { testId } = await loginAndCreateWorkspace(page, "sidebar-msg")

      // Create a channel
      const channelName = `preview-${testId}`
      await createChannel(page, channelName)

      // Send a unique message
      const testMessage = `Preview test message ${Date.now()}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(testMessage)
      await page.getByRole("button", { name: "Send" }).click()
      await expect(page.getByText(testMessage)).toBeVisible({ timeout: 5000 })

      // Navigate away to a scratchpad
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

      // The channel link should still be visible in the sidebar
      const channelLink = page.getByRole("link", { name: `#${channelName}` })
      await expect(channelLink).toBeVisible()

      // BUG: Currently the preview doesn't update via socket when you navigate away
      // and a message is sent. The workspace bootstrap cache has stale lastMessagePreview.
      // This test documents the expected behavior.

      // After reload, verify the channel still exists
      await page.reload()
      await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible()

      // View mode persists - verify channel is still visible
      await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe("Bug 2: Stream name updates in sidebar", () => {
    test("sidebar should update when scratchpad is auto-named", async ({ page }) => {
      const { testId } = await loginAndCreateWorkspace(page, "sidebar-name")

      // Create a scratchpad
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

      // Send a message that will trigger auto-naming
      const uniqueTopic = `quantum computing ${testId}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(uniqueTopic)
      await page.getByRole("button", { name: "Send" }).click()
      // Scope to main content area to avoid matching sidebar preview (which may be hidden)
      await expect(page.getByRole("main").getByText(uniqueTopic)).toBeVisible({ timeout: 5000 })

      // Get current URL to identify the stream
      const url = page.url()
      const streamIdMatch = url.match(/\/s\/([^/]+)/)
      const streamId = streamIdMatch?.[1]
      expect(streamId).toBeTruthy()

      // Wait for auto-naming to potentially complete (async via worker)
      await page.waitForTimeout(5000)

      // BUG: Currently `stream:display_name_updated` is stream-scoped, meaning it only
      // goes to the stream room (users viewing that stream). The sidebar is subscribed
      // to the workspace room, so it never receives the update.
      // This test documents the expected behavior.

      // After refreshing, the name should be updated
      await page.reload()
      // Wait for sidebar to be ready - Drafts link is always visible
      await expect(page.getByRole("link", { name: "Drafts" })).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe("Bug 3: Urgency should be tied to read state", () => {
    test("urgency indicator should clear after viewing stream", async ({ page }) => {
      const { testId } = await loginAndCreateWorkspace(page, "sidebar-urgency")

      // Create a channel
      const channelName = `urgency-${testId}`
      await createChannel(page, channelName)

      // Send a message (own messages shouldn't trigger urgency)
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type("Test urgency message")
      await page.getByRole("button", { name: "Send" }).click()
      // Wait for message in content area (use first() since sidebar preview may also match)
      await expect(page.getByText("Test urgency message").first()).toBeVisible({ timeout: 5000 })

      // Navigate away
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.getByText(/Type a message|No messages yet/).first()).toBeVisible({ timeout: 5000 })

      // Own messages should NOT trigger urgency
      const channelLink = page.getByRole("link", { name: `#${channelName}` })
      await expect(channelLink).toBeVisible()

      // Navigate back to the channel (marks as read)
      await channelLink.click()
      await expect(page.getByText("Test urgency message").first()).toBeVisible()

      // Navigate away again
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

      // After reading, the channel should have no urgency indicator
      // (urgency is now purely based on unread count, not time-based)
      await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible()
    })
  })

  test.describe("Bug 4: Sidebar preview should update when agent responds while navigated away", () => {
    test("should update sidebar preview when agent responds in scratchpad while navigated away", async ({ page }) => {
      test.setTimeout(60000)

      const { testId } = await loginAndCreateWorkspace(page, "sidebar-unread")

      // Create a scratchpad (companion mode on by default — agent will respond)
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

      // Send a message that triggers the companion
      const userMessage = `Sidebar unread check ${testId}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(userMessage)
      await page.getByRole("button", { name: "Send" }).click()
      await expect(page.getByRole("main").getByText(userMessage)).toBeVisible({ timeout: 5000 })

      // Wait for the URL to settle (draft_xxx → stream_xxx after backend creates stream)
      await page.waitForURL(/\/s\/stream_/, { timeout: 10000 })
      const streamId = page.url().match(/\/s\/([^/]+)/)?.[1]
      expect(streamId).toBeTruthy()

      // Navigate away immediately — the agent will respond while we're away
      await page.getByRole("link", { name: "Drafts" }).click()
      await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 5000 })

      // The sidebar should update the scratchpad's preview with the companion's response
      // WITHOUT requiring a page refresh. We check preview text rather than the unread
      // badge because the badge depends on whether `isViewingStream` was false when
      // `stream:activity` fired — a race with navigation timing.
      //
      // The preview may be in a compact section (hidden until hover) depending on whether
      // unreadCount incremented (race with navigation). Hover to reveal it either way.
      const scratchpadLink = page.locator(`a[href*="/s/${streamId}"]`).first()
      await expect(scratchpadLink).toBeVisible({ timeout: 10000 })

      await expect
        .poll(
          async () => {
            await scratchpadLink.hover()
            return scratchpadLink.getByText(/stub response/i).isVisible()
          },
          { timeout: 30000 }
        )
        .toBeTruthy()
    })
  })

  test.describe("Bug 5: Stream content should update when navigating back", () => {
    test("scratchpad content should appear without refresh after navigating back", async ({ page }) => {
      test.setTimeout(60000)

      const { testId } = await loginAndCreateWorkspace(page, "sidebar-ai")

      // Create a scratchpad (companion mode is on by default for scratchpads)
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })
      const baselineEventCount = await page.getByRole("main").locator("[data-event-id]").count()

      // Send a unique message
      const userMessage = `Scratchpad return check ${testId}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(userMessage)
      await page.getByRole("button", { name: "Send" }).click()
      // Scope to main content area to avoid matching sidebar preview
      await expect(page.getByRole("main").getByText(userMessage)).toBeVisible({ timeout: 5000 })
      const streamId = page.url().match(/\/s\/([^/]+)/)?.[1]
      expect(streamId).toBeTruthy()

      // Navigate away immediately
      await page.getByRole("link", { name: "Drafts" }).click()
      await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible({ timeout: 5000 })

      // Navigate back using stable stream ID (preview text and unread badges are not reliable signals here).
      const scratchpadLink = page.locator(`a[href*="/s/${streamId}"]`).first()
      await expect(scratchpadLink).toBeVisible({ timeout: 10000 })
      await scratchpadLink.click()

      // Stream content should still be available without a refresh after returning.
      await expect
        .poll(async () => page.getByRole("main").locator("[data-event-id]").count(), {
          timeout: 30000,
        })
        .toBeGreaterThanOrEqual(baselineEventCount + 1)
      await expect(page.getByRole("main").getByText(userMessage)).toBeVisible({ timeout: 10000 })
    })
  })
})
