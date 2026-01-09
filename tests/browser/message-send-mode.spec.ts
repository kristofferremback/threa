import { test, expect } from "@playwright/test"

/**
 * Tests for configurable message send mode feature.
 *
 * Two modes:
 * - "cmdEnter" (default): Cmd/Ctrl+Enter sends, Enter creates newlines
 * - "enter": Enter sends, Shift+Enter creates newlines
 */

test.describe("Message Send Mode", () => {
  const testId = Date.now().toString(36)
  const workspaceName = `SendMode Test ${testId}`

  /**
   * Helper to open settings dialog via keyboard shortcut.
   * Uses Cmd+. (Mac) which is the app's default shortcut.
   */
  async function openSettings(page: import("@playwright/test").Page) {
    await page.keyboard.press("Meta+.")
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 })
  }

  /**
   * Helper to change send mode in settings.
   * Uses exact role match for radio buttons since both labels contain "Enter to send".
   */
  async function setSendMode(page: import("@playwright/test").Page, mode: "enter" | "cmdEnter") {
    await openSettings(page)
    // The Send Messages section might be on Appearance or Keyboard tab
    // Try to click Keyboard tab if visible
    const keyboardTab = page.getByRole("tab", { name: /keyboard/i })
    if (await keyboardTab.isVisible()) {
      await keyboardTab.click()
    }

    // Use exact name match for radio buttons
    if (mode === "enter") {
      await page.getByRole("radio", { name: "Enter to send", exact: true }).click()
    } else {
      await page.getByRole("radio", { name: /Ctrl.*Enter to send/ }).click()
    }
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).not.toBeVisible()
  }

  test.beforeEach(async ({ page }) => {
    // Login as Alice
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    // Wait for workspace page
    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    // Create workspace if needed
    const workspaceInput = page.getByPlaceholder("New workspace name")
    if (await workspaceInput.isVisible()) {
      await workspaceInput.fill(workspaceName)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    // Wait for sidebar to be visible
    await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible()
  })

  test.describe("default cmdEnter mode", () => {
    test("should send message with Cmd+Enter", async ({ page }) => {
      // Create a scratchpad to test in
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      const messageContent = `CmdEnter test ${testId}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(messageContent)

      // Cmd+Enter should send
      await page.keyboard.press("Meta+Enter")

      // Message should appear in the page (sent successfully)
      // Wait for it to appear outside the editor
      await expect(page.locator("p").filter({ hasText: messageContent }).first()).toBeVisible({ timeout: 5000 })
    })

    test("should create newline with Enter (not send)", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      const line1 = `Line1 ${testId}`
      const line2 = `Line2 ${testId}`

      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(line1)
      await page.keyboard.press("Enter")
      await page.keyboard.type(line2)

      // Both lines should be in the editor
      const editor = page.locator("[contenteditable='true']")
      await expect(editor).toContainText(line1)
      await expect(editor).toContainText(line2)

      // Verify message is still in editor (not sent) by checking editor still has content
      // and "Start a conversation" text is still visible (no messages sent yet)
      await expect(page.getByText("Start a conversation")).toBeVisible()
    })

    test("should show correct placeholder in cmdEnter mode", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      // TipTap placeholder is rendered via CSS ::before with attr(data-placeholder)
      // Find any element with data-placeholder attribute in the editor area
      const placeholderText = await page.locator("[data-placeholder]").first().getAttribute("data-placeholder")

      // Should mention Cmd+Enter (the default mode)
      expect(placeholderText).toContain("Cmd+Enter")
    })
  })

  test.describe("enter mode (via settings)", () => {
    test.beforeEach(async ({ page }) => {
      // Change to enter mode
      await setSendMode(page, "enter")
    })

    test("should send message with Enter", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      const messageContent = `Enter send test ${testId}-${Date.now()}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(messageContent)

      // Enter should send in this mode
      await page.keyboard.press("Enter")

      // Message should appear (sent successfully)
      await expect(page.locator("p").filter({ hasText: messageContent }).first()).toBeVisible({ timeout: 5000 })
    })

    test("should create newline with Shift+Enter (not send)", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      const line1 = `ShiftEnter Line1 ${testId}`
      const line2 = `ShiftEnter Line2 ${testId}`

      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(line1)
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type(line2)

      // Both lines should be in the editor
      const editor = page.locator("[contenteditable='true']")
      await expect(editor).toContainText(line1)
      await expect(editor).toContainText(line2)

      // Verify message not sent - "Start a conversation" still visible
      await expect(page.getByText("Start a conversation")).toBeVisible()
    })

    test("should show correct placeholder in enter mode", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      // TipTap placeholder is rendered via CSS ::before with attr(data-placeholder)
      // Find any element with data-placeholder attribute in the editor area
      const placeholderText = await page.locator("[data-placeholder]").first().getAttribute("data-placeholder")

      // Should mention "Enter to send" but NOT "Cmd+Enter"
      expect(placeholderText).toContain("Enter to send")
      expect(placeholderText).not.toContain("Cmd+Enter")
    })

    test("Cmd+Enter should NOT send in enter mode", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      const messageContent = `CmdEnter should not send ${testId}`
      await page.locator("[contenteditable='true']").click()
      await page.keyboard.type(messageContent)

      // Cmd+Enter should NOT send in this mode
      await page.keyboard.press("Meta+Enter")

      // Verify nothing was sent by checking both conditions:
      // 1. Editor still contains the message (would be cleared on send)
      // 2. "Start a conversation" still visible (would be hidden if message appeared)
      const editor = page.locator("[contenteditable='true']")
      await expect(editor).toContainText(messageContent)
      await expect(page.getByText("Start a conversation")).toBeVisible()
    })
  })

  test.describe("multi-line content in enter mode", () => {
    test.beforeEach(async ({ page }) => {
      // Change to enter mode
      await setSendMode(page, "enter")
    })

    test("should create multi-line content with Shift+Enter", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      await page.locator("[contenteditable='true']").click()

      // Type multi-line content using Shift+Enter for newlines
      await page.keyboard.type("Line 1 content")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("Line 2 content")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("Line 3 content")

      // All lines should be in editor (verifies Shift+Enter creates newlines, not sends)
      const editor = page.locator("[contenteditable='true']")
      await expect(editor).toContainText("Line 1 content")
      await expect(editor).toContainText("Line 2 content")
      await expect(editor).toContainText("Line 3 content")

      // Message should NOT have been sent - "Start a conversation" still visible
      await expect(page.getByText("Start a conversation")).toBeVisible()
    })

    test("should support code blocks with Shift+Enter for newlines", async ({ page }) => {
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      await page.locator("[contenteditable='true']").click()

      // Type code block opener
      await page.keyboard.type("```")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("const x = 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("const y = 2")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("```")

      // Code should be in editor
      const editor = page.locator("[contenteditable='true']")
      await expect(editor).toContainText("const x = 1")
      await expect(editor).toContainText("const y = 2")
    })
  })

  test.describe("preference persistence", () => {
    test("should persist send mode preference across page reload", async ({ page }) => {
      // Change to enter mode
      await setSendMode(page, "enter")

      // Create scratchpad and verify placeholder shows enter mode
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      // Verify placeholder shows "Enter to send"
      await expect(page.locator("[data-placeholder]").first()).toHaveAttribute("data-placeholder", /Enter to send/, {
        timeout: 3000,
      })

      // Reload page
      await page.reload()

      // Wait for app to load
      await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible({ timeout: 10000 })

      // Create another scratchpad
      await page.getByRole("button", { name: "+ New Scratchpad" }).click()
      await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

      // Verify placeholder still shows "Enter to send" after reload (preference persisted)
      await expect(page.locator("[data-placeholder]").first()).toHaveAttribute("data-placeholder", /Enter to send/, {
        timeout: 5000,
      })
    })
  })
})
