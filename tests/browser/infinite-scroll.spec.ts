import { test, expect, type Page, type Request } from "@playwright/test"
import { loginAndCreateWorkspace, createChannel, expectApiOk } from "./helpers"

/**
 * Tests for infinite scroll pagination and "Jump to latest" button.
 *
 * These tests create a channel with more than 50 messages (the bootstrap page size)
 * and verify:
 * 1. Bootstrap loads only the most recent batch
 * 2. Scrolling to top fetches older messages
 * 3. "Jump to latest" button appears when scrolled far from bottom
 * 4. Clicking "Jump to latest" scrolls back to the most recent messages
 */

/** Send N messages to a stream via the API (much faster than typing in the editor). */
async function seedMessages(
  page: Page,
  workspaceId: string,
  streamId: string,
  count: number,
  prefix: string
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const response = await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
      data: { streamId, content: `${prefix} msg-${String(i).padStart(3, "0")}` },
    })
    await expectApiOk(response, `Send message ${i}`)
  }
}

/** Extract workspaceId and streamId from the current URL. */
function extractIds(page: Page): { workspaceId: string; streamId: string } {
  const url = page.url()
  const workspaceMatch = url.match(/\/w\/([^/]+)/)
  const streamMatch = url.match(/\/s\/([^/?]+)/)
  if (!workspaceMatch || !streamMatch) {
    throw new Error(`Could not extract IDs from URL: ${url}`)
  }
  return { workspaceId: workspaceMatch[1], streamId: streamMatch[1] }
}

/** Locate a specific message by its zero-padded number within the main content area. */
function messageLocator(page: Page, prefix: string, num: number) {
  // Use .first() because sidebar previews can also match the same text within main
  return page
    .getByRole("main")
    .getByText(`${prefix} msg-${String(num).padStart(3, "0")}`, { exact: true })
    .first()
}

test.describe("Infinite Scroll", () => {
  const MESSAGE_COUNT = 65 // Exceeds the 50-event bootstrap page size
  let testId: string

  test.beforeEach(async ({ page }) => {
    const result = await loginAndCreateWorkspace(page, "scroll-test")
    testId = result.testId
  })

  test("should load older messages when scrolling to the top", async ({ page }) => {
    const channelName = `scroll-older-${testId}`
    await createChannel(page, channelName)

    const { workspaceId, streamId } = extractIds(page)
    const prefix = `[${testId}]`

    // Seed messages via API
    await seedMessages(page, workspaceId, streamId, MESSAGE_COUNT, prefix)

    // Navigate fresh to get a clean bootstrap (with only the latest ~50 events)
    await page.goto(`/w/${workspaceId}/s/${streamId}`)

    // Wait for messages to render — the latest message should be visible
    await expect(messageLocator(page, prefix, MESSAGE_COUNT)).toBeVisible({ timeout: 10000 })

    // The earliest message should NOT be visible yet (it's beyond the bootstrap window)
    await expect(messageLocator(page, prefix, 1)).not.toBeVisible()

    // Track event pagination requests
    const eventRequests: Request[] = []
    page.on("request", (request) => {
      if (request.url().includes("/events") && request.url().includes("before=")) {
        eventRequests.push(request)
      }
    })

    // Scroll to the very top of the container
    await page.evaluate(() => {
      const container = document.querySelector("[data-suppress-pull-refresh]")
      if (container) container.scrollTop = 0
    })

    // Wait for the pagination request to fire and older messages to appear
    await expect
      .poll(() => eventRequests.length, {
        timeout: 10000,
        message: "should fetch older events when scrolled to top",
      })
      .toBeGreaterThan(0)

    // The earliest message should now be visible after pagination loaded it
    await expect(messageLocator(page, prefix, 1)).toBeVisible({ timeout: 10000 })

    // Verify no runaway infinite loop — only 1-2 pagination requests expected
    // (one to exhaust the remaining messages)
    expect(eventRequests.length).toBeLessThanOrEqual(3)
  })

  test("should show 'Jump to latest' when scrolled far from bottom and hide when scrolled back", async ({ page }) => {
    const channelName = `scroll-jump-${testId}`
    await createChannel(page, channelName)

    const { workspaceId, streamId } = extractIds(page)
    const prefix = `[${testId}]`

    await seedMessages(page, workspaceId, streamId, MESSAGE_COUNT, prefix)

    await page.goto(`/w/${workspaceId}/s/${streamId}`)
    await expect(messageLocator(page, prefix, MESSAGE_COUNT)).toBeVisible({ timeout: 10000 })

    // "Jump to latest" button should not be visible when at the bottom
    const jumpButton = page.getByRole("button", { name: "Jump to latest" })
    await expect(jumpButton).not.toBeVisible()

    // Scroll to the top
    await page.evaluate(() => {
      const container = document.querySelector("[data-suppress-pull-refresh]")
      if (container) container.scrollTop = 0
    })

    // "Jump to latest" should appear
    await expect(jumpButton).toBeVisible({ timeout: 5000 })

    // Click it — should scroll back to bottom
    await jumpButton.click()

    // Button should disappear after scrolling back to bottom
    await expect(jumpButton).not.toBeVisible({ timeout: 5000 })

    // The latest message should be visible again
    await expect(messageLocator(page, prefix, MESSAGE_COUNT)).toBeVisible()
  })

  test("should not make pagination requests when all messages fit in bootstrap", async ({ page }) => {
    const channelName = `scroll-nopage-${testId}`
    await createChannel(page, channelName)

    const { workspaceId, streamId } = extractIds(page)
    const prefix = `[${testId}]`

    // Send only 10 messages — well within the 50-event bootstrap limit
    await seedMessages(page, workspaceId, streamId, 10, prefix)

    // Track event pagination requests
    const eventRequests: Request[] = []
    page.on("request", (request) => {
      if (request.url().includes("/events") && request.url().includes("before=")) {
        eventRequests.push(request)
      }
    })

    await page.goto(`/w/${workspaceId}/s/${streamId}`)

    // First and last messages should be visible
    await expect(messageLocator(page, prefix, 1)).toBeVisible({ timeout: 10000 })
    await expect(messageLocator(page, prefix, 10)).toBeVisible({ timeout: 10000 })

    // Scroll to top
    await page.evaluate(() => {
      const container = document.querySelector("[data-suppress-pull-refresh]")
      if (container) container.scrollTop = 0
    })

    // Wait a moment to ensure no spurious requests fire
    await page.waitForTimeout(1000)

    // No pagination requests should have been made
    expect(eventRequests.length).toBe(0)
  })
})
