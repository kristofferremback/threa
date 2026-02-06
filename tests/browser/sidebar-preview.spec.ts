import { test, expect } from "@playwright/test"

/**
 * Tests that the sidebar preview mode works like Notion's sidebar:
 * hovering near the left edge shows a preview, clicking inside it
 * does NOT pin it open, and moving the mouse away collapses it.
 *
 * Pinning only happens via the explicit "Pin sidebar" topbar button.
 */

test.describe("Sidebar Preview Behavior", () => {
  const testId = Date.now().toString(36)

  async function loginAsAlice(page: import("@playwright/test").Page) {
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()
    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    const workspaceInput = page.getByPlaceholder("New workspace name")
    if (await workspaceInput.isVisible()) {
      await workspaceInput.fill(`Sidebar Preview ${testId}`)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible({ timeout: 10000 })
  }

  async function switchToAllView(page: import("@playwright/test").Page) {
    const allButton = page.getByRole("button", { name: "All" })
    await allButton.waitFor({ state: "visible", timeout: 3000 }).catch(() => {})
    if (await allButton.isVisible()) {
      await allButton.click()
      await expect(page.getByRole("heading", { name: "Channels", level: 3 })).toBeVisible({ timeout: 5000 })
    }
  }

  async function createChannel(page: import("@playwright/test").Page, channelName: string) {
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })
    await switchToAllView(page)
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })
  }

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
    await loginAsAlice(page)

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
    await loginAsAlice(page)

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
