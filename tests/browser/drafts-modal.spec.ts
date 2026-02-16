import { test, expect, type Page } from "@playwright/test"

/**
 * Tests for the Drafts page feature.
 *
 * Tests:
 * 1. Drafts link greyed when empty, highlighted when drafts exist
 * 2. Draft in channel appears on page
 * 3. Draft in scratchpad appears on page
 * 4. Navigate to draft from page
 * 5. Delete draft with confirmation
 * 6. Cancel delete keeps draft
 * 7. Quick switcher command "> drafts" navigates to page
 * 8. Attachment-only draft appears on page
 * 9. Implicit clear (no confirmation) auto-deletes draft
 * 10. Thread draft navigation with draft panel opening
 */

/** Wait for the drafts link to become highlighted (draftCount > 0 after IndexedDB write). */
async function waitForDraftSaved(page: Page) {
  await expect(page.locator('a[href*="/drafts"]')).not.toHaveClass(/text-muted-foreground/, { timeout: 5000 })
}

test.describe("Drafts Page", () => {
  const testId = Date.now().toString(36)
  const testEmail = `drafts-test-${testId}@example.com`
  const testName = `Drafts Test ${testId}`
  const workspaceName = `Drafts Test WS ${testId}`

  // Helper to switch to All view mode (needed to access section buttons in Smart view)
  async function switchToAllView(page: import("@playwright/test").Page) {
    const allButton = page.getByRole("button", { name: "All" })
    if (await allButton.isVisible()) {
      await allButton.click()
      await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible({ timeout: 5000 })
    }
  }

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

    // Wait for sidebar to be visible (empty state shows buttons)
    await expect(page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })
  })

  test("should show greyed drafts link when no drafts exist", async ({ page }) => {
    // Verify Drafts link is visible but greyed out (has text-muted-foreground class)
    const draftsLink = page.locator('a[href*="/drafts"]')
    await expect(draftsLink).toBeVisible()
    await expect(draftsLink).toHaveClass(/text-muted-foreground/)
  })

  test("should highlight drafts link when draft exists in channel", async ({ page }) => {
    // Create a channel
    const channelName = `draft-channel-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Type something in the editor to create a draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Draft message ${testId}`
    await page.keyboard.type(draftContent)

    // Wait for draft to be saved (debounced at 500ms)
    await waitForDraftSaved(page)

    // Navigate away to another location (switch to All view to access button, then create scratchpad)
    await switchToAllView(page)
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet|Start a conversation/).first()).toBeVisible({
      timeout: 5000,
    })

    // Verify Drafts link is highlighted (no longer greyed out)
    const draftsLink = page.locator('a[href*="/drafts"]')
    await expect(draftsLink).toBeVisible({ timeout: 2000 })
    await expect(draftsLink).not.toHaveClass(/text-muted-foreground/)
  })

  test("should show draft content on drafts page", async ({ page }) => {
    // Create a channel and draft
    const channelName = `page-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Test draft for page ${testId}`
    await page.keyboard.type(draftContent)
    await waitForDraftSaved(page)

    // Navigate away (switch to All view to access button)
    await switchToAllView(page)
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet|Start a conversation/).first()).toBeVisible({
      timeout: 5000,
    })

    // Click Drafts link to navigate to page
    await page.locator('a[href*="/drafts"]').click()

    // Verify we're on the drafts page
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })

    // Verify page shows the draft
    const draftItem = page.getByRole("option").first()
    await expect(draftItem).toBeVisible()
    await expect(draftItem.getByText(draftContent.slice(0, 40))).toBeVisible()
    await expect(draftItem.getByText(`#${channelName}`)).toBeVisible()
  })

  test("should navigate to draft location when clicking draft on page", async ({ page }) => {
    // Create a channel and draft
    const channelName = `nav-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Navigate test ${testId}`
    await page.keyboard.type(draftContent)
    await waitForDraftSaved(page)

    // Navigate to drafts page
    await page.locator('a[href*="/drafts"]').click()
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })

    // Click on the draft item to navigate
    const draftItem = page.getByRole("option").first()
    await draftItem.click()

    // Should be back in the channel (URL contains the channel stream ID)
    await expect(page).toHaveURL(new RegExp(`/s/stream_`), { timeout: 5000 })

    // Channel heading should be visible (verifies we're in the right channel)
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible()
  })

  test("should delete draft with confirmation when clicking delete button", async ({ page }) => {
    // Create a channel and draft
    const channelName = `delete-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Delete test ${testId}`
    await page.keyboard.type(draftContent)
    await waitForDraftSaved(page)

    // Navigate to drafts page
    await page.locator('a[href*="/drafts"]').click()
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })

    // Hover over draft item to reveal delete button
    const draftItem = page.getByRole("option").first()
    await draftItem.hover()

    // Click delete button (the action button within the draft item)
    await draftItem.getByRole("button", { name: /delete/i }).click()

    // Confirmation dialog should appear
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByText(/delete this draft/i)).toBeVisible({ timeout: 2000 })

    // Confirm deletion (use the Delete button within the dialog)
    await dialog.getByRole("button", { name: "Delete" }).click()

    // Draft should be removed from page (no options in listbox)
    await expect(page.getByRole("option")).not.toBeVisible({ timeout: 5000 })

    // Page should show empty state
    await expect(page.getByText(/no drafts/i)).toBeVisible()
  })

  test("should keep draft when canceling delete confirmation", async ({ page }) => {
    // Create a channel and draft
    const channelName = `cancel-delete-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Cancel delete ${testId}`
    await page.keyboard.type(draftContent)
    await waitForDraftSaved(page)

    // Navigate to drafts page
    await page.locator('a[href*="/drafts"]').click()
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })

    // Hover and click delete
    const draftItem = page.getByRole("option").first()
    await draftItem.hover()
    await draftItem.getByRole("button", { name: /delete/i }).click()

    // Cancel the confirmation
    await page.getByRole("button", { name: /cancel/i }).click()

    // Draft should still be visible on page
    await expect(draftItem.getByText(draftContent.slice(0, 30))).toBeVisible()
  })

  test("should navigate to drafts page via quick switcher command", async ({ page }) => {
    // Create a channel and draft first
    const channelName = `qs-drafts-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Create draft
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    await page.keyboard.type(`QS test ${testId}`)
    await waitForDraftSaved(page)

    // Navigate away (switch to All view to access button)
    await switchToAllView(page)
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet|Start a conversation/).first()).toBeVisible({
      timeout: 5000,
    })

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

    // Quick switcher should close and we should be on the drafts page
    await expect(page.getByText("Stream search")).not.toBeVisible({ timeout: 2000 })
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })
  })

  test("should show attachment-only draft on page", async ({ page }) => {
    // Create a channel
    const channelName = `attach-only-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

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
    await waitForDraftSaved(page)

    // Navigate away (switch to All view to access button)
    await switchToAllView(page)
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet|Start a conversation/).first()).toBeVisible({
      timeout: 5000,
    })

    // Drafts link should not be greyed (attachment-only draft counts)
    const draftsLink = page.locator('a[href*="/drafts"]')
    await expect(draftsLink).toBeVisible({ timeout: 2000 })
    await expect(draftsLink).not.toHaveClass(/text-muted-foreground/)

    // Navigate to page and verify draft shows attachment indicator
    await draftsLink.click()
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })
    const draftItem = page.getByRole("option").first()
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
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Type draft content
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Auto clear test ${testId}`
    await page.keyboard.type(draftContent)
    await waitForDraftSaved(page)

    // Verify draft was saved by checking Drafts link is highlighted
    const draftsLink = page.locator('a[href*="/drafts"]')
    await expect(draftsLink).toBeVisible({ timeout: 2000 })
    await expect(draftsLink).not.toHaveClass(/text-muted-foreground/)

    // Clear the editor by selecting all and deleting - this should auto-delete the draft
    // Use ControlOrMeta modifier to work on both macOS and Linux (CI)
    await editor.click()
    await editor.press("ControlOrMeta+a")
    await page.keyboard.press("Backspace")

    // Wait for auto-delete to complete (debounce + IndexedDB write + reactive update)
    // Use longer timeout for CI where things are slower
    await expect(draftsLink).toHaveClass(/text-muted-foreground/, { timeout: 5000 })
  })

  test("should show scratchpad draft on page", async ({ page }) => {
    // Create a scratchpad
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.getByText(/Type a message|No messages yet|Start a conversation/).first()).toBeVisible({
      timeout: 5000,
    })

    // Type in the scratchpad
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const draftContent = `Scratchpad draft ${testId}`
    await page.keyboard.type(draftContent)
    await waitForDraftSaved(page)

    // Create a channel to navigate away
    const channelName = `sp-draft-test-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Drafts link should not be greyed
    const draftsLink = page.locator('a[href*="/drafts"]')
    await expect(draftsLink).toBeVisible({ timeout: 2000 })
    await expect(draftsLink).not.toHaveClass(/text-muted-foreground/)

    // Navigate to page and verify scratchpad draft is shown
    await draftsLink.click()
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })
    const draftItem = page.getByRole("option").first()
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
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Send a message to reply to
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    await page.keyboard.type(`Parent message ${testId}`)
    await page.keyboard.press("Meta+Enter")

    // Wait for the message to be sent and appear in the timeline
    await expect(page.getByText(`Parent message ${testId}`)).toBeVisible({ timeout: 5000 })

    // Click "Reply in thread" link to start a thread draft (appears on hover)
    // Scope to main content area to avoid matching sidebar preview
    const messageContainer = page
      .getByRole("main")
      .locator(".group")
      .filter({ hasText: `Parent message ${testId}` })
      .first()
    await messageContainer.hover()

    // Wait for the link to become visible, then click it
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 2000 })
    await replyLink.click()

    // Wait for draft thread panel to appear - look for the panel content
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Type in the thread draft
    const threadEditor = page.locator("[contenteditable='true']").last()
    await threadEditor.click()
    const threadDraftContent = `Thread reply draft ${testId}`
    await page.keyboard.type(threadDraftContent)
    await waitForDraftSaved(page)

    // Navigate away by creating another channel (switch to All view to access button)
    await switchToAllView(page)
    const otherChannelName = `other-channel-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(otherChannelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${otherChannelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Drafts link should not be greyed (has thread draft)
    const draftsLink = page.locator('a[href*="/drafts"]')
    await expect(draftsLink).toBeVisible({ timeout: 2000 })
    await expect(draftsLink).not.toHaveClass(/text-muted-foreground/)

    // Navigate to drafts page
    await draftsLink.click()
    await expect(page).toHaveURL(/\/drafts$/, { timeout: 2000 })

    // Verify the thread draft is shown with "Thread in #channel" label
    const draftItem = page.getByRole("option").first()
    await expect(draftItem).toBeVisible()
    await expect(draftItem.getByText(`Thread in #${channelName}`)).toBeVisible()

    // Click on the thread draft to navigate
    await draftItem.click()

    // URL should have the draft parameter
    await expect(page).toHaveURL(/[?&]draft=/, { timeout: 5000 })

    // Wait for the composer to be visible (draft panel has opened)
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })
  })
})
