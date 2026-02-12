import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, createChannel } from "./helpers"

/**
 * Tests that the sidebar preview mode works like Notion's sidebar:
 * hovering near the left edge shows a preview, clicking inside it
 * does NOT pin it open, and moving the mouse away collapses it.
 *
 * Pinning only happens via the explicit "Pin sidebar" topbar button.
 */

test.describe("Sidebar Preview Behavior", () => {
  /** Hover near the left edge to trigger sidebar preview from collapsed state */
  async function hoverToPreview(page: import("@playwright/test").Page) {
    const viewport = page.viewportSize()!
    await page.mouse.move(15, viewport.height / 2)
  }

  /** Move mouse to center of viewport (away from sidebar) */
  async function moveAwayFromSidebar(page: import("@playwright/test").Page) {
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
  }

  test("should not pin sidebar when clicking a channel in preview mode", async ({ page }) => {
    const { testId } = await loginAndCreateWorkspace(page, "sidebar-preview")

    const sidebar = page.getByRole("navigation", { name: "Sidebar navigation" })

    // Set up: create a channel while sidebar is pinned
    const channelName = `preview-test-${testId}`
    await createChannel(page, channelName)

    // Navigate away so the channel link becomes clickable in sidebar
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByRole("main").getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Collapse the sidebar via topbar
    await page.getByRole("button", { name: "Collapse sidebar" }).click()
    await expect(sidebar).toHaveCSS("width", "6px", { timeout: 3000 })

    // Hover near left edge to trigger preview
    await hoverToPreview(page)
    await expect(sidebar).not.toHaveCSS("width", "6px", { timeout: 3000 })

    // Click the channel link inside the previewed sidebar
    await page.getByRole("link", { name: `#${channelName}` }).click()

    // Sidebar should still be visible (mouse is over it)
    await expect(sidebar).not.toHaveCSS("width", "6px")

    // Move mouse away from sidebar
    await moveAwayFromSidebar(page)

    // Sidebar should collapse (proves it was preview, not pinned)
    await expect(sidebar).toHaveCSS("width", "6px", { timeout: 3000 })
  })

  test("topbar pin button should still pin the sidebar", async ({ page }) => {
    await loginAndCreateWorkspace(page, "sidebar-pin")

    const sidebar = page.getByRole("navigation", { name: "Sidebar navigation" })

    // Sidebar starts pinned
    await expect(sidebar).not.toHaveCSS("width", "6px")

    // Collapse via topbar
    await page.getByRole("button", { name: "Collapse sidebar" }).click()
    await expect(sidebar).toHaveCSS("width", "6px", { timeout: 3000 })

    // Pin via topbar
    await page.getByRole("button", { name: "Pin sidebar" }).click()
    await expect(sidebar).not.toHaveCSS("width", "6px", { timeout: 3000 })

    // Move mouse away - sidebar should stay open because it's pinned
    await moveAwayFromSidebar(page)
    await page.waitForTimeout(500)
    await expect(sidebar).not.toHaveCSS("width", "6px")
  })
})
