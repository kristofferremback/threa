import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, createChannel } from "./helpers"

/**
 * Sidebar real-time update E2E tests.
 *
 * Tests that sidebar updates correctly when:
 * 1. New messages arrive (preview should update)
 * 2. Stream is renamed (name should update in sidebar)
 * 3. Messages from other users appear when navigating to stream
 */

test.describe("Sidebar Updates", () => {
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
      await expect(page.getByRole("main").locator(".message-item").getByText(userMessage).first()).toBeVisible({
        timeout: 5000,
      })

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

      // Wait for sidebar preview text to reflect the companion response.
      // Read text content directly (instead of nested visibility checks) to avoid hover rendering races.
      await expect
        .poll(
          async () => {
            await scratchpadLink.hover()
            const previewText = ((await scratchpadLink.textContent()) ?? "").toLowerCase()
            return previewText.includes("stub response")
          },
          { timeout: 45000 }
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
      await expect(page.getByRole("main").locator(".message-item").getByText(userMessage).first()).toBeVisible({
        timeout: 5000,
      })

      // Wait for the draft route to settle to a real stream before navigating
      // away; otherwise we may capture a transient draft_* id that disappears
      // from the sidebar once the backend creates the persistent scratchpad.
      await page.waitForURL(/\/s\/stream_/, { timeout: 10000 })
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
      await expect(page.getByRole("main").locator(".message-item").getByText(userMessage).first()).toBeVisible({
        timeout: 10000,
      })
    })
  })
})
