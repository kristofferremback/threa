import { test, expect } from "@playwright/test"

/**
 * Tests for formatting keyboard shortcuts.
 *
 * The editor displays rich text formatting visually (bold, italic, etc.)
 * but exports as markdown when copying or sending.
 *
 * Shortcuts:
 * - Cmd+B → bold (visually styled, exports as **text**)
 * - Cmd+I → italic (visually styled, exports as *text*)
 * - Cmd+Shift+S → strikethrough (visually styled, exports as ~~text~~)
 * - Cmd+E → inline code (visually styled, exports as `text`)
 * - Cmd+Shift+C → code block
 */

test.describe("Formatting Shortcuts", () => {
  const testId = Date.now().toString(36)
  const workspaceName = `Formatting Test ${testId}`

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
    await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible()

    // Create a scratchpad to test in
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })
  })

  test.describe("without selection (cursor only)", () => {
    test("Cmd+B should toggle bold and allow typing bold text", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Type some text first
      await page.keyboard.type("hello ")

      // Press Cmd+B to enter bold mode
      await page.keyboard.press("ControlOrMeta+b")

      // Type inside bold
      await page.keyboard.type("bold")

      // Press Cmd+B again to exit bold mode
      await page.keyboard.press("ControlOrMeta+b")
      await page.keyboard.type(" world")

      // Editor should show styled text with bold element
      await expect(editor.locator("strong")).toContainText("bold")
      await expect(editor).toContainText("hello bold world")
    })

    test("Cmd+I should toggle italic and allow typing italic text", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")
      await page.keyboard.press("ControlOrMeta+i")
      await page.keyboard.type("italic")
      await page.keyboard.press("ControlOrMeta+i")
      await page.keyboard.type(" world")

      await expect(editor.locator("em")).toContainText("italic")
      await expect(editor).toContainText("hello italic world")
    })

    test("Cmd+Shift+S should toggle strikethrough", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")
      await page.keyboard.press("ControlOrMeta+Shift+s")
      await page.keyboard.type("struck")
      await page.keyboard.press("ControlOrMeta+Shift+s")
      await page.keyboard.type(" world")

      await expect(editor.locator("s")).toContainText("struck")
      await expect(editor).toContainText("hello struck world")
    })

    test("Cmd+E should toggle inline code", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("run ")
      await page.keyboard.press("ControlOrMeta+e")
      await page.keyboard.type("npm install")
      await page.keyboard.press("ControlOrMeta+e")
      await page.keyboard.type(" to install")

      await expect(editor.locator("code")).toContainText("npm install")
      await expect(editor).toContainText("run npm install to install")
    })

    test("Cmd+Shift+C should create code block", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.press("ControlOrMeta+Shift+c")
      await page.keyboard.type("const x = 1")

      // Should have a code block (pre element)
      await expect(editor.locator("pre")).toBeVisible()
      await expect(editor.locator("pre")).toContainText("const x = 1")
    })
  })

  test.describe("with text selection", () => {
    test("Cmd+B should make selected text bold", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Type text and select all with Cmd+A
      await page.keyboard.type("world")
      await page.keyboard.press("ControlOrMeta+a")

      // Apply bold
      await page.keyboard.press("ControlOrMeta+b")

      // Should wrap the selection in strong
      await expect(editor.locator("strong")).toContainText("world")
    })

    test("Cmd+I should make selected text italic", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("italic")
      await page.keyboard.press("ControlOrMeta+a")

      await page.keyboard.press("ControlOrMeta+i")

      await expect(editor.locator("em")).toContainText("italic")
    })

    test("Cmd+Shift+S should strikethrough selected text", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("text")
      await page.keyboard.press("ControlOrMeta+a")

      await page.keyboard.press("ControlOrMeta+Shift+s")

      await expect(editor.locator("s")).toContainText("text")
    })

    test("Cmd+E should make selected text inline code", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("myVar")
      await page.keyboard.press("ControlOrMeta+a")

      await page.keyboard.press("ControlOrMeta+e")

      await expect(editor.locator("code")).toContainText("myVar")
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
      await page.keyboard.press("ControlOrMeta+b")
      await page.keyboard.type("bold text")

      await expect(editor.locator("strong")).toContainText("bold text")
    })
  })

  test.describe("toolbar buttons produce same result as shortcuts", () => {
    test("bold toolbar button should apply bold formatting", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")

      // Click bold button in toolbar
      await page.getByRole("button", { name: "Bold" }).click()
      await page.keyboard.type("toolbar")

      await expect(editor.locator("strong")).toContainText("toolbar")
    })

    test("italic toolbar button should apply italic formatting", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("hello ")

      // Click italic button in toolbar
      await page.getByRole("button", { name: "Italic" }).click()
      await page.keyboard.type("toolbar")

      await expect(editor.locator("em")).toContainText("toolbar")
    })

    test("code toolbar button should apply code formatting", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      await page.keyboard.type("run ")

      // Click code button in toolbar
      await page.getByRole("button", { name: "Inline code" }).click()
      await page.keyboard.type("npm")

      await expect(editor.locator("code")).toContainText("npm")
    })
  })
})
