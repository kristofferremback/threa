import { test, expect } from "@playwright/test"

/**
 * Tests for the Drafts modal feature.
 *
 * Tests:
 * 1. Drafts button greyed when empty, highlighted when drafts exist
 * 2. Draft in channel appears in modal
 * 3. Draft in scratchpad appears in modal
 * 4. Navigate to draft from modal
 * 5. Delete draft with confirmation
 * 6. Cancel delete keeps draft
 * 7. Quick switcher command "> drafts" opens modal
 * 8. Attachment-only draft appears in modal
 * 9. Implicit clear (no confirmation) auto-deletes draft
 * 10. Thread draft navigation with draft panel opening
 */

test.describe("Drafts Modal", () => {
  const testId = Date.now().toString(36)
  const testEmail = `drafts-test-${testId}@example.com`
  const testName = `Drafts Test ${testId}`
  const workspaceName = `Drafts Test WS ${testId}`

  // Helper to create a test image as a buffer (1x1 red PNG)
  function createTestImage(): Buffer {
    return Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
      0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4,
      0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
  }

  test.beforeEach(async ({ page }) => {
    // Login and create workspace
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await expect(page.getByRole("heading", { name: "Test Login" })).toBeVisible()

    await page.getByLabel("Email").fill(testEmail)
    await page.getByLabel("Name").fill(testName)
    await page.getByRole("button", { name: "Sign In" }).click()

    // Wait for workspace selection page
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible()

    // Create workspace
    const workspaceInput = page.getByPlaceholder("New workspace name")
    await workspaceInput.fill(workspaceName)
    const createButton = page.getByRole("button", { name: "Create Workspace" })
    await expect(createButton).toBeEnabled()
    await createButton.click()

    // Wait for sidebar to be visible (workspace loaded)
    await expect(page.getByRole("heading", { name: "Channels", level: 3 })).toBeVisible({ timeout: 10000 })
  })

  test("should show greyed drafts button when no drafts exist", async ({ page }) => {
    // Verify Drafts button is visible but greyed out (has text-muted-foreground class)
    const draftsButton = page.getByTestId("drafts-button")
    await expect(draftsButton).toBeVisible()
    await expect(draftsButton).toHaveClass(/text-muted-foreground/)
  })

  test("should highlight drafts button when draft exists in channel", async ({ page }) => {
    // Create a channel
    const channelName = `draft-channel-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Type something in the editor to create a draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Draft message ${testId}`
    await page.keyboard.type(draftContent)

    // Wait for draft to be saved (debounced at 500ms)
    await page.waitForTimeout(700)

    // Navigate away to another location (create scratchpad)
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Verify Drafts button is highlighted (no longer greyed out)
    const draftsButton = page.getByTestId("drafts-button")
    await expect(draftsButton).toBeVisible({ timeout: 2000 })
    await expect(draftsButton).not.toHaveClass(/text-muted-foreground/)
  })

  test("should open drafts modal and show draft content", async ({ page }) => {
    // Create a channel and draft
    const channelName = `modal-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Test draft for modal ${testId}`
    await page.keyboard.type(draftContent)
    await page.waitForTimeout(700)

    // Navigate away
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Click Drafts button to open modal
    await page.getByRole("button", { name: /Drafts/ }).click()

    // Verify modal opens and shows the draft
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await expect(draftItem).toBeVisible()
    await expect(draftItem.getByText(draftContent.slice(0, 40))).toBeVisible()
    await expect(draftItem.getByText(`#${channelName}`)).toBeVisible()
  })

  test("should navigate to draft location when clicking draft in modal", async ({ page }) => {
    // Create a channel and draft
    const channelName = `nav-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Navigate test ${testId}`
    await page.keyboard.type(draftContent)
    await page.waitForTimeout(700)

    // Navigate away to scratchpad
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Open drafts modal
    await page.getByRole("button", { name: /Drafts/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })

    // Click on the draft item to navigate
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await draftItem.click()

    // Modal should close
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 2000 })

    // Should be back in the channel (URL contains the channel stream ID)
    await expect(page).toHaveURL(new RegExp(`/s/stream_`), { timeout: 5000 })

    // Channel name should be visible in sidebar
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible()
  })

  test("should delete draft with confirmation when clicking delete button", async ({ page }) => {
    // Create a channel and draft
    const channelName = `delete-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Delete test ${testId}`
    await page.keyboard.type(draftContent)
    await page.waitForTimeout(700)

    // Navigate away
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Open drafts modal
    await page.getByRole("button", { name: /Drafts/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })

    // Hover over draft item to reveal delete button
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await draftItem.hover()

    // Click delete button
    await draftItem.getByRole("button", { name: /delete/i }).click()

    // Confirmation dialog should appear
    await expect(page.getByText(/delete this draft/i)).toBeVisible({ timeout: 2000 })

    // Confirm deletion
    await page.getByTestId("confirm-delete").click()

    // Wait for delete to complete and UI to update
    await page.waitForTimeout(500)

    // Draft should be removed from modal (check within the dialog)
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByTestId("draft-item")).not.toBeVisible({ timeout: 2000 })

    // Modal should show empty state
    await expect(dialog.getByText(/no drafts/i)).toBeVisible()
  })

  test("should keep draft when canceling delete confirmation", async ({ page }) => {
    // Create a channel and draft
    const channelName = `cancel-delete-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Cancel delete ${testId}`
    await page.keyboard.type(draftContent)
    await page.waitForTimeout(700)

    // Navigate away
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Open drafts modal
    await page.getByRole("button", { name: /Drafts/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })

    // Hover and click delete
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await draftItem.hover()
    await draftItem.getByRole("button", { name: /delete/i }).click()

    // Cancel the confirmation
    await page.getByRole("button", { name: /cancel/i }).click()

    // Draft should still be visible in modal
    await expect(draftItem.getByText(draftContent.slice(0, 30))).toBeVisible()
  })

  test("should open drafts modal via quick switcher command", async ({ page }) => {
    // Create a channel and draft first
    const channelName = `qs-drafts-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    await page.keyboard.type(`QS test ${testId}`)
    await page.waitForTimeout(700)

    // Navigate away
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Open quick switcher with Cmd+K
    await page.keyboard.press("Meta+k")
    await expect(page.getByText("Stream search")).toBeVisible({ timeout: 2000 })

    // Type command prefix and search for drafts
    await page.keyboard.type("> drafts")
    await page.waitForTimeout(300)

    // Should see "View Drafts" command
    await expect(page.getByText("View Drafts")).toBeVisible({ timeout: 2000 })

    // Select the command
    await page.keyboard.press("Enter")

    // Quick switcher should close and drafts modal should open
    await expect(page.getByText("Stream search")).not.toBeVisible({ timeout: 2000 })
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })
  })

  test("should show attachment-only draft in modal", async ({ page }) => {
    // Create a channel
    const channelName = `attach-only-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Focus editor and paste an image (no text)
    const editor = page.locator("[contenteditable='true']")
    await editor.click()

    const imageBuffer = createTestImage()
    await page.evaluate(async (imageData) => {
      const editor = document.querySelector("[contenteditable='true']")
      if (!editor) throw new Error("Editor not found")

      const uint8Array = new Uint8Array(imageData)
      const blob = new Blob([uint8Array], { type: "image/png" })
      const file = new File([blob], "attachment.png", { type: "image/png" })

      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      })

      editor.dispatchEvent(pasteEvent)
    }, Array.from(imageBuffer))

    // Wait for upload
    await expect(page.getByText("pasted-image-1.png")).toBeVisible({ timeout: 10000 })

    // Wait for draft to be saved
    await page.waitForTimeout(700)

    // Navigate away
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Drafts button should appear (attachment-only draft counts)
    const draftsButton = page.getByRole("button", { name: /Drafts/ })
    await expect(draftsButton).toBeVisible({ timeout: 2000 })

    // Open modal and verify draft shows attachment indicator (shows number next to paperclip icon)
    await draftsButton.click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await expect(draftItem).toBeVisible()
    // The attachment count is shown as just a number with a paperclip icon
    await expect(draftItem.getByText("1")).toBeVisible()
  })

  test("should auto-delete draft when clearing input (no confirmation)", async ({ page }) => {
    // Create a channel
    const channelName = `auto-clear-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Type draft content
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Auto clear test ${testId}`
    await page.keyboard.type(draftContent)
    await page.waitForTimeout(700)

    // Verify draft was saved by checking Drafts button appears in sidebar
    // (button only shows when there are drafts)
    await expect(page.getByTestId("drafts-button")).toBeVisible({ timeout: 2000 })

    // Clear the editor by selecting all and deleting - this should auto-delete the draft
    await editor.click()
    await page.keyboard.press("Meta+a")
    await page.keyboard.press("Backspace")

    // Wait for auto-delete to complete
    await page.waitForTimeout(700)

    // Drafts button should be greyed out since the only draft was deleted
    await expect(page.getByTestId("drafts-button")).toHaveClass(/text-muted-foreground/, { timeout: 2000 })
  })

  test("should show scratchpad draft in modal", async ({ page }) => {
    // Create a scratchpad
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet/)).toBeVisible({ timeout: 5000 })

    // Type in the scratchpad
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Scratchpad draft ${testId}`
    await page.keyboard.type(draftContent)
    await page.waitForTimeout(700)

    // Create a channel to navigate away
    const channelName = `sp-draft-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Drafts button should appear
    const draftsButton = page.getByRole("button", { name: /Drafts/ })
    await expect(draftsButton).toBeVisible({ timeout: 2000 })

    // Open modal and verify scratchpad draft is shown
    await draftsButton.click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await expect(draftItem).toBeVisible()
    await expect(draftItem.getByText(draftContent.slice(0, 30))).toBeVisible()
  })

  test("should navigate to thread draft and open draft panel", async ({ page }) => {
    // Create a channel
    const channelName = `thread-draft-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // Send a message to reply to
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    await page.keyboard.type(`Parent message ${testId}`)
    await page.keyboard.press("Meta+Enter")

    // Wait for the message to be sent and appear in the timeline
    await expect(page.getByText(`Parent message ${testId}`)).toBeVisible({ timeout: 5000 })

    // Click the reply button to start a thread draft (hover to reveal the button)
    const messageContainer = page
      .locator(".group")
      .filter({ hasText: `Parent message ${testId}` })
      .first()
    await messageContainer.hover()

    // Click the reply button (MessageSquareReply icon button)
    const replyButton = messageContainer.getByRole("button")
    await replyButton.click()

    // Wait for draft thread panel to appear
    await expect(page.getByText("Write your reply below")).toBeVisible({ timeout: 3000 })

    // Type in the thread draft
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const threadDraftContent = `Thread reply draft ${testId}`
    await page.keyboard.type(threadDraftContent)
    await page.waitForTimeout(700)

    // Navigate away by creating another channel
    const otherChannelName = `other-channel-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(otherChannelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${otherChannelName}` })).toBeVisible({ timeout: 5000 })

    // Drafts button should appear with the thread draft
    const draftsButton = page.getByRole("button", { name: /Drafts/ })
    await expect(draftsButton).toBeVisible({ timeout: 2000 })

    // Open modal
    await draftsButton.click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 })

    // Verify the thread draft is shown with "Thread in #channel" label
    const draftItem = page.locator("[data-testid='draft-item']").first()
    await expect(draftItem).toBeVisible()
    await expect(draftItem.getByText(`Thread in #${channelName}`)).toBeVisible()

    // Click on the thread draft to navigate
    await draftItem.click()

    // Modal should close
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 2000 })

    // URL should have the draft parameter
    await expect(page).toHaveURL(/[?&]draft=/, { timeout: 5000 })

    // Draft thread panel should be visible with the draft content
    await expect(page.getByText("Write your reply below")).toBeVisible({ timeout: 3000 })
  })
})
