import { test, expect } from "@playwright/test"

/**
 * Tests for Linear-style rich text editing.
 *
 * Features tested:
 * - Inline formatting via markdown input rules (**bold**, *italic*, etc.)
 * - Keyboard shortcuts toggle marks (Cmd+B, Cmd+I, etc.)
 * - Block formatting (lists, code blocks, blockquotes, headings)
 * - Tab/Shift+Tab for list indentation
 * - Double-enter to exit blocks
 * - Copy serializes to markdown, paste parses markdown
 * - Send modes still work with rich text
 */

test.describe("Rich Text Editing", () => {
  const testId = Date.now().toString(36)
  const workspaceName = `RichText Test ${testId}`

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

    // Create a scratchpad for testing
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })
  })

  test.describe("Inline Formatting - Input Rules", () => {
    test("typing **text** converts to bold", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("**bold text**")

      // Verify styled bold, no raw asterisks visible
      await expect(editor.locator("strong")).toHaveText("bold text")
      await expect(editor).not.toContainText("**")
    })

    test("typing *text* converts to italic", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("*italic text*")

      await expect(editor.locator("em")).toHaveText("italic text")
      await expect(editor).not.toContainText("*italic")
    })

    test("typing ~~text~~ converts to strikethrough", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("~~struck text~~")

      await expect(editor.locator("s")).toHaveText("struck text")
      await expect(editor).not.toContainText("~~")
    })

    test("typing `code` converts to inline code", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("`inline code`")

      await expect(editor.locator("code")).toHaveText("inline code")
      // Raw backticks should be gone
      await expect(editor).not.toContainText("`inline")
    })
  })

  test.describe("Inline Formatting - Keyboard Shortcuts", () => {
    test("Cmd+B toggles bold on selection", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("some text")

      // Select all and apply bold
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("ControlOrMeta+b")

      await expect(editor.locator("strong")).toHaveText("some text")

      // Toggle off
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("ControlOrMeta+b")
      await expect(editor.locator("strong")).not.toBeVisible()
    })

    test("Cmd+I toggles italic on selection", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("text to italicize")

      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("ControlOrMeta+i")

      await expect(editor.locator("em")).toHaveText("text to italicize")
    })

    test("Cmd+E toggles inline code on selection", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("variable_name")

      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("ControlOrMeta+e")

      await expect(editor.locator("code")).toHaveText("variable_name")
    })

    test("Cmd+Shift+S toggles strikethrough", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("crossed out")

      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("ControlOrMeta+Shift+s")

      await expect(editor.locator("s")).toHaveText("crossed out")
    })
  })

  test.describe("Block Formatting - Lists", () => {
    test("typing '- ' creates bullet list", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("- first item")

      await expect(editor.locator("ul li")).toContainText("first item")
    })

    test("typing '1. ' creates numbered list", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("1. first item")

      await expect(editor.locator("ol li")).toContainText("first item")
    })

    test("Shift+Enter in list creates new item", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("- item one")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("item two")

      await expect(editor.locator("ul li")).toHaveCount(2)
    })

    test("Shift+Enter on empty list item exits list", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("- item")
      await page.keyboard.press("Shift+Enter")
      // Empty list item
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("not in list")

      // Should have exited the list - list has 1 item, and paragraph with text exists
      await expect(editor.locator("ul li")).toHaveCount(1)
      await expect(editor.getByText("not in list")).toBeVisible()
      // The text should NOT be inside the list
      await expect(editor.locator("ul li").filter({ hasText: "not in list" })).toHaveCount(0)
    })

    test("Tab indents list item", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("- parent")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("child")
      await page.keyboard.press("Tab")

      // Verify nested list structure
      await expect(editor.locator("ul ul li")).toContainText("child")
    })

    test("Shift+Tab outdents list item", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("- parent")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("child")
      await page.keyboard.press("Tab") // Indent
      await page.keyboard.press("Shift+Tab") // Outdent

      // Verify back to top level
      await expect(editor.locator("ul > li")).toHaveCount(2)
    })
  })

  test.describe("Block Formatting - Code Blocks", () => {
    test("typing ``` + space creates code block", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      // TipTap input rule triggers on space after backticks
      await page.keyboard.type("``` ")
      await page.keyboard.type("const x = 1")

      await expect(editor.locator("pre code")).toContainText("const x = 1")
    })

    test("typing ``` + Shift+Enter creates code block", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      // Shift+Enter triggers code block creation just like Enter would in cmdEnter mode
      await page.keyboard.type("```")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("const y = 2")

      await expect(editor.locator("pre code")).toContainText("const y = 2")
    })

    test("Tab in code block inserts spaces", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      // TipTap input rule triggers on space after backticks
      await page.keyboard.type("``` ")
      await page.keyboard.press("Tab")
      await page.keyboard.type("indented")

      // Verify indentation (2 spaces)
      await expect(editor.locator("pre code")).toContainText("  indented")
    })

    test("Cmd+Shift+C toggles code block", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("some code")
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("ControlOrMeta+Shift+c")

      await expect(editor.locator("pre")).toBeVisible()
    })
  })

  test.describe("Block Formatting - Blockquotes", () => {
    test("typing '> ' creates blockquote", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("> quoted text")

      await expect(editor.locator("blockquote")).toContainText("quoted text")
    })

    test("Shift+Enter adds line within blockquote", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("> line one")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("line two")

      // Both lines should be within the blockquote
      await expect(editor.locator("blockquote")).toContainText("line one")
      await expect(editor.locator("blockquote")).toContainText("line two")
    })
  })

  test.describe("Block Formatting - Headings", () => {
    test("typing '# ' creates H1", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("# Heading One")

      await expect(editor.locator("h1")).toHaveText("Heading One")
    })

    test("typing '## ' creates H2", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("## Heading Two")

      await expect(editor.locator("h2")).toHaveText("Heading Two")
    })

    test("typing '### ' creates H3", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("### Heading Three")

      await expect(editor.locator("h3")).toHaveText("Heading Three")
    })

    // Note: backspace-at-start-of-heading is not supported by TipTap's Heading extension.
    // Users can use Cmd+Shift+0 or the toolbar to convert headings to paragraphs.
  })

  test.describe("Toolbar Buttons", () => {
    test("bold button toggles bold", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("text")
      await page.keyboard.press("ControlOrMeta+a")

      // Click bold button
      await page.getByRole("button", { name: "Bold" }).click()
      await expect(editor.locator("strong")).toHaveText("text")
    })

    test("bullet list button creates list", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("item")

      // Click bullet list button
      await page.getByRole("button", { name: "Bullet list" }).click()
      await expect(editor.locator("ul li")).toContainText("item")
    })

    test("quote button creates blockquote", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("quoted")

      await page.getByRole("button", { name: "Quote" }).click()
      await expect(editor.locator("blockquote")).toContainText("quoted")
    })
  })

  test.describe("Send Mode Integration", () => {
    test("Enter sends in enter-mode (formatting preserved)", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      // Create bold text
      await page.keyboard.type("**bold message**")
      await expect(editor.locator("strong")).toBeVisible()

      // Enter should send
      await page.keyboard.press("Enter")

      // Message should appear in timeline (sent successfully)
      await expect(page.locator("p").filter({ hasText: "bold message" }).first()).toBeVisible({ timeout: 5000 })
    })

    test("Shift+Enter creates newline without sending", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()
      await page.keyboard.type("line 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("line 2")

      // Both lines should be in editor
      await expect(editor).toContainText("line 1")
      await expect(editor).toContainText("line 2")

      // Not sent - placeholder still visible
      await expect(page.getByText("Start a conversation")).toBeVisible()
    })
  })

  test.describe("Copy/Paste", () => {
    test("paste markdown converts to styled text", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Paste markdown via clipboard
      await page.evaluate(() => {
        const clipboardData = new DataTransfer()
        clipboardData.setData("text/plain", "**pasted bold** and `code`")
        const event = new ClipboardEvent("paste", { clipboardData, bubbles: true })
        document.querySelector("[contenteditable='true']")?.dispatchEvent(event)
      })

      await expect(editor.locator("strong")).toHaveText("pasted bold")
      await expect(editor.locator("code")).toHaveText("code")
    })
  })

  test.describe("Unified Newlines", () => {
    test("Shift+Enter creates new paragraph (unified with Enter in cmdEnter mode)", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // In default enter mode, Shift+Enter should create new paragraph
      await page.keyboard.type("line 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("line 2")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("line 3")

      // All three lines should be in separate paragraphs
      await expect(editor.locator("p")).toHaveCount(3)
      await expect(editor).toContainText("line 1")
      await expect(editor).toContainText("line 2")
      await expect(editor).toContainText("line 3")
    })
  })

  test.describe("VS Code-style Tab Indentation", () => {
    test("Tab with multi-line selection indents all lines (preserves content)", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Create multi-line content
      await page.keyboard.type("line 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("line 2")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("line 3")

      // Select all and press Tab
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("Tab")

      // All lines should still exist (not replaced with tab)
      await expect(editor).toContainText("line 1")
      await expect(editor).toContainText("line 2")
      await expect(editor).toContainText("line 3")
    })

    test("Tab in code block with multi-line selection indents all lines", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Create a code block with content
      await page.keyboard.type("```")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("const a = 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("const b = 2")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("const c = 3")

      // Select all content in code block (Cmd+A should select within code block first)
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("Tab")

      // All lines should be indented but still exist
      const codeContent = await editor.locator("pre code").textContent()
      expect(codeContent).toContain("const a = 1")
      expect(codeContent).toContain("const b = 2")
      expect(codeContent).toContain("const c = 3")
    })

    test("Shift+Tab with multi-line selection dedents all lines", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Create indented multi-line content in code block
      await page.keyboard.type("```")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("\tconst a = 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("\tconst b = 2")

      // Select all and dedent
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("Shift+Tab")

      // Content should be dedented but still exist
      const codeContent = await editor.locator("pre code").textContent()
      expect(codeContent).toContain("const a = 1")
      expect(codeContent).toContain("const b = 2")
    })
  })

  test.describe("Shift+Enter in Lists", () => {
    test("Shift+Enter in list item creates new item (same as Enter)", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Create a list
      await page.keyboard.type("- item 1")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("item 2")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("item 3")

      // Should have 3 list items
      await expect(editor.locator("ul li")).toHaveCount(3)
      await expect(editor).toContainText("item 1")
      await expect(editor).toContainText("item 2")
      await expect(editor).toContainText("item 3")
    })
  })

  test.describe("Code Block with Shift+Enter", () => {
    test("Shift+Enter after ``` creates code block (same as Enter)", async ({ page }) => {
      const editor = page.locator("[contenteditable='true']")
      await editor.click()

      // Type ``` and press Shift+Enter (should create code block just like Enter)
      await page.keyboard.type("```")
      await page.keyboard.press("Shift+Enter")
      await page.keyboard.type("code content")

      await expect(editor.locator("pre code")).toContainText("code content")
    })
  })
})
