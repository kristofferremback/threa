import { test, expect } from "@playwright/test"

/**
 * Emoji shortcut E2E tests.
 *
 * Tests the Slack-style :shortcode: emoji feature:
 * 1. Emoji picker popup appears when typing ":"
 * 2. Query filters emoji results
 * 3. Selecting emoji inserts it
 * 4. Typing :shortcode: auto-converts to emoji
 */

test.describe("Emoji Shortcuts", () => {
  const testId = Date.now().toString(36)

  // Helper to set up a workspace with an editor ready
  async function setupWorkspaceWithEditor(page: import("@playwright/test").Page) {
    // Login as Alice
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    // Wait for workspace page
    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    // Create workspace if needed
    const workspaceInput = page.getByPlaceholder("New workspace name")
    if (await workspaceInput.isVisible()) {
      await workspaceInput.fill(`Emoji Test ${testId}`)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    // Wait for sidebar (empty state shows buttons, populated state shows headings)
    await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible()

    // Create a scratchpad to get an editor
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Get the editor
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    return editor
  }

  test("should show emoji picker when typing colon", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":" to trigger emoji picker
    await page.keyboard.type(":")

    // Emoji grid should appear
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })
  })

  test("should filter emojis when typing query after colon", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":" first and wait for grid
    await page.keyboard.type(":")
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })

    // Type query to filter (use "grin" which matches "grinning" and "grin")
    await page.keyboard.type("grin")

    // Grid should still be visible with filtered results
    await expect(page.locator("[data-emoji-grid]")).toBeVisible()

    // Should show grinning emoji
    await expect(page.locator("[data-emoji-grid] button").first()).toBeVisible()
  })

  test("should insert emoji when clicking on grid item", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":fire" to search
    await page.keyboard.type(":fire")

    // Wait for grid
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })

    // Click the first emoji in the grid
    await page.locator("[data-emoji-grid] button").first().click()

    // Emoji should be inserted - check for emoji node in editor
    await expect(editor.locator("[data-type='emoji']")).toBeVisible()

    // Grid should close after selection
    await expect(page.locator("[data-emoji-grid]")).not.toBeVisible()
  })

  test("should insert emoji when pressing Enter on selected item", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":smile" to search
    await page.keyboard.type(":smile")

    // Wait for grid
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })

    // Press Enter to select first item
    await page.keyboard.press("Enter")

    // Emoji should be inserted
    await expect(editor.locator("[data-type='emoji']")).toBeVisible()

    // Grid should close
    await expect(page.locator("[data-emoji-grid]")).not.toBeVisible()
  })

  test("should insert emoji when pressing Tab on selected item", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":heart" to search
    await page.keyboard.type(":heart")

    // Wait for grid
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })

    // Press Tab to select first item
    await page.keyboard.press("Tab")

    // Emoji should be inserted
    await expect(editor.locator("[data-type='emoji']")).toBeVisible()

    // Grid should close
    await expect(page.locator("[data-emoji-grid]")).not.toBeVisible()
  })

  test("should match emojis by alias shortcodes", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":thumbsup" - alias for 👍 (primary shortcode is "+1")
    await page.keyboard.type(":thumbsup")

    // Wait for grid to show the thumbs up emoji
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })
    await expect(page.locator("[data-emoji-grid] button").first()).toBeVisible()

    // Tab also works for selection (Enter works too, tested separately)
    await page.keyboard.press("Tab")

    // Emoji should be inserted
    await expect(editor.locator("[data-type='emoji']")).toBeVisible()
  })

  test("should auto-convert :shortcode: when typing closing colon", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type a complete shortcode with closing colon
    await page.keyboard.type(":fire:")

    // Emoji should be auto-converted to emoji node
    await expect(editor.locator("[data-type='emoji']")).toBeVisible({ timeout: 2000 })

    // The emoji picker should NOT be visible (input rule handled it)
    await expect(page.locator("[data-emoji-grid]")).not.toBeVisible()
  })

  test("should close emoji picker when pressing Escape", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":" to trigger picker
    await page.keyboard.type(":")

    // Wait for grid
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })

    // Press Escape
    await page.keyboard.press("Escape")

    // Grid should close
    await expect(page.locator("[data-emoji-grid]")).not.toBeVisible()
  })

  test("should navigate emoji grid with arrow keys", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type ":" to show all emojis
    await page.keyboard.type(":")

    // Wait for grid
    await expect(page.locator("[data-emoji-grid]")).toBeVisible({ timeout: 2000 })

    // First item should be selected by default
    const buttons = page.locator("[data-emoji-grid] button")
    await expect(buttons.first()).toHaveAttribute("data-selected", "true")

    // Press ArrowRight to move to second item
    await page.keyboard.press("ArrowRight")

    // Second item should now be selected
    await expect(buttons.nth(1)).toHaveAttribute("data-selected", "true")
    await expect(buttons.first()).not.toHaveAttribute("data-selected", "true")

    // Press ArrowLeft to go back
    await page.keyboard.press("ArrowLeft")
    await expect(buttons.first()).toHaveAttribute("data-selected", "true")
  })

  test("should send message with emoji", async ({ page }) => {
    const editor = await setupWorkspaceWithEditor(page)

    // Type emoji shortcode
    await page.keyboard.type(":fire:")

    // Wait for emoji to convert in editor
    await expect(editor.locator("[data-type='emoji']")).toBeVisible({ timeout: 2000 })

    // Type additional text after the emoji
    await page.keyboard.type(" Great job!")

    // Send the message
    await page.getByRole("button", { name: "Send" }).click()

    // Message should appear with emoji rendered (stored as :fire: but displayed as 🔥)
    await expect(page.getByText("🔥 Great job!")).toBeVisible({ timeout: 5000 })
  })
})
