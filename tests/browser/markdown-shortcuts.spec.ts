import { test, expect } from "@playwright/test"

/**
 * Tests for markdown formatting keyboard shortcuts.
 *
 * These shortcuts insert markdown syntax rather than toggling rich text marks,
 * since the editor uses plain text with markdown rendering on send.
 *
 * Shortcuts:
 * - Cmd+B → **bold**
 * - Cmd+I → *italic*
 * - Cmd+Shift+S → ~~strikethrough~~
 * - Cmd+E → `inline code`
 * - Cmd+Shift+C → ```code block```
 */

test.describe("Markdown Formatting Shortcuts", () => {
  const testId = Date.now().toString(36)
  const workspaceName = `Markdown Test ${testId}`

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

    // Create a scratchpad to test in
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })
  })

  test.describe("without selection (cursor only)", () => {
    test("Cmd+B should insert bold markers and place cursor between them", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Type some text first
      await page.keyboard.type("hello ")

      // Press Cmd+B
      await page.keyboard.press("Meta+b")

      // Type inside the markers
      await page.keyboard.type("bold")

      // Continue typing outside
      await page.keyboard.press("End")
      await page.keyboard.type(" world")

      // Editor should contain the markdown
      await expect(editor).toContainText("hello **bold** world")
    })

    test("Cmd+I should insert italic markers and place cursor between them", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")
      await page.keyboard.press("Meta+i")
      await page.keyboard.type("italic")
      await page.keyboard.press("End")
      await page.keyboard.type(" world")

      await expect(editor).toContainText("hello *italic* world")
    })

    test("Cmd+Shift+S should insert strikethrough markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")
      await page.keyboard.press("Meta+Shift+s")
      await page.keyboard.type("struck")
      await page.keyboard.press("End")
      await page.keyboard.type(" world")

      await expect(editor).toContainText("hello ~~struck~~ world")
    })

    test("Cmd+E should insert inline code markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("run ")
      await page.keyboard.press("Meta+e")
      await page.keyboard.type("npm install")
      await page.keyboard.press("End")
      await page.keyboard.type(" to install")

      await expect(editor).toContainText("run `npm install` to install")
    })

    test("Cmd+Shift+C should insert code block markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.press("Meta+Shift+c")
      await page.keyboard.type("const x = 1")

      // Should have code block syntax
      await expect(editor).toContainText("```")
      await expect(editor).toContainText("const x = 1")
    })
  })

  test.describe("with text selection", () => {
    test("Cmd+B should wrap selected text with bold markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Type text and select all with Cmd+A
      await page.keyboard.type("world")
      await page.keyboard.press("Meta+a")

      // Apply bold
      await page.keyboard.press("Meta+b")

      // Should wrap the selection
      await expect(editor).toContainText("**world**")
    })

    test("Cmd+I should wrap selected text with italic markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("italic")
      await page.keyboard.press("Meta+a")

      await page.keyboard.press("Meta+i")

      await expect(editor).toContainText("*italic*")
    })

    test("Cmd+Shift+S should wrap selected text with strikethrough markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("text")
      await page.keyboard.press("Meta+a")

      await page.keyboard.press("Meta+Shift+s")

      await expect(editor).toContainText("~~text~~")
    })

    test("Cmd+E should wrap selected text with code markers", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("myVar")
      await page.keyboard.press("Meta+a")

      await page.keyboard.press("Meta+e")

      await expect(editor).toContainText("`myVar`")
    })
  })

  test.describe("shortcuts work after sending message", () => {
    test("should work on fresh editor after send", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Send a message first
      await page.keyboard.type("First message")
      await page.keyboard.press("Meta+Enter")

      // Wait for message to appear
      await expect(page.locator("p").filter({ hasText: "First message" }).first()).toBeVisible({ timeout: 5000 })

      // Now try the shortcut on the cleared editor
      await editor.click()
      await page.keyboard.press("Meta+b")
      await page.keyboard.type("bold text")

      await expect(editor).toContainText("**bold text**")
    })
  })

  test.describe("toolbar buttons produce same result as shortcuts", () => {
    test("bold toolbar button should insert same markers as Cmd+B", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")

      // Click bold button in toolbar (aria-label="Bold")
      await page.getByRole("button", { name: "Bold" }).click()
      await page.keyboard.type("toolbar")

      await expect(editor).toContainText("hello **toolbar**")
    })

    test("italic toolbar button should insert same markers as Cmd+I", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")

      // Click italic button in toolbar (aria-label="Italic")
      await page.getByRole("button", { name: "Italic" }).click()
      await page.keyboard.type("toolbar")

      await expect(editor).toContainText("hello *toolbar*")
    })

    test("code toolbar button should insert same markers as Cmd+E", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("run ")

      // Click code button in toolbar (aria-label="Inline code")
      await page.getByRole("button", { name: "Inline code" }).click()
      await page.keyboard.type("npm")

      await expect(editor).toContainText("run `npm`")
    })
  })
})
