import { test, expect, type Page } from "@playwright/test"

/**
 * Tests for editor auto-focus behavior:
 *
 * 1. Main editor focused on page load
 * 2. Main editor refocused after stream navigation
 * 3. Thread panel editor focused on panel open
 * 4. Type-to-focus: typing in main view focuses main editor + inserts character
 * 5. Type-to-focus: typing with panel open focuses panel editor when last clicked
 * 6. Focus restoration after inline edit cancel
 */

async function setupWorkspace(page: Page) {
  const setupId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const testEmail = `focus-test-${setupId}@example.com`
  const testName = `Focus Test ${setupId}`
  const workspaceName = `Focus WS ${setupId}`

  await page.goto("/login")
  await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
  await expect(page.getByRole("heading", { name: "Test Login" })).toBeVisible()

  await page.getByLabel("Email").fill(testEmail)
  await page.getByLabel("Name").fill(testName)
  await page.getByRole("button", { name: "Sign In" }).click()

  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible()

  const workspaceInput = page.getByPlaceholder("New workspace name")
  await workspaceInput.fill(workspaceName)
  const createButton = page.getByRole("button", { name: "Create Workspace" })
  await expect(createButton).toBeEnabled()
  await createButton.click()

  await expect(page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })

  return { setupId, testName }
}

async function createChannel(page: Page, name: string) {
  page.once("dialog", async (dialog) => {
    await dialog.accept(name)
  })
  await page.getByRole("button", { name: "+ New Channel" }).click()
  await expect(page.getByRole("heading", { name: `#${name}`, level: 1 })).toBeVisible({ timeout: 5000 })
}

async function sendMessage(page: Page, text: string) {
  const editor = page.locator("[data-editor-zone='main'] [contenteditable='true']")
  await editor.click()
  await page.keyboard.type(text)
  await page.keyboard.press("Meta+Enter")
  await expect(page.getByRole("main").getByText(text)).toBeVisible({ timeout: 5000 })
}

test.describe("Editor Auto-Focus", () => {
  test.beforeEach(async ({ page }) => {
    await setupWorkspace(page)
  })

  test("main editor is focused on page load", async ({ page }) => {
    const testId = Date.now().toString(36)
    const channelName = `focus-load-${testId}`
    await createChannel(page, channelName)

    // The editor should already be focused — type and verify
    const mainEditor = page.locator("[data-editor-zone='main'] [contenteditable='true']")
    await expect(mainEditor).toBeFocused({ timeout: 3000 })
  })

  test("main editor refocuses after stream navigation", async ({ page }) => {
    const testId = Date.now().toString(36)

    // Create two channels
    const channel1 = `focus-nav-a-${testId}`
    const channel2 = `focus-nav-b-${testId}`
    await createChannel(page, channel1)
    await createChannel(page, channel2)

    // Navigate back to channel1 via sidebar
    await page.getByRole("link", { name: `#${channel1}` }).click()
    await expect(page.getByRole("heading", { name: `#${channel1}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Editor should be focused after navigation
    const mainEditor = page.locator("[data-editor-zone='main'] [contenteditable='true']")
    await expect(mainEditor).toBeFocused({ timeout: 3000 })
  })

  test("thread panel editor is focused on panel open", async ({ page }) => {
    const testId = Date.now().toString(36)
    const channelName = `focus-panel-${testId}`
    await createChannel(page, channelName)

    // Send a message to get a thread target
    await sendMessage(page, `Panel focus test ${testId}`)

    // Open thread panel
    const messageContainer = page
      .getByRole("main")
      .locator(".group")
      .filter({ hasText: `Panel focus test ${testId}` })
      .first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    // Wait for the thread panel to appear
    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // The panel's editor should be focused
    const panelEditor = page.locator("[data-editor-zone='panel'] [contenteditable='true']")
    await expect(panelEditor).toBeFocused({ timeout: 3000 })
  })

  test("type-to-focus: typing focuses main editor and inserts character", async ({ page }) => {
    const testId = Date.now().toString(36)
    const channelName = `focus-type-${testId}`
    await createChannel(page, channelName)

    // Click somewhere outside the editor to blur it (e.g. the header)
    await page.locator("header").first().click()

    // Verify the editor lost focus
    const mainEditor = page.locator("[data-editor-zone='main'] [contenteditable='true']")
    await expect(mainEditor).not.toBeFocused()

    // Type a character — should auto-focus and insert
    await page.keyboard.press("h")

    await expect(mainEditor).toBeFocused({ timeout: 2000 })
    await expect(mainEditor).toContainText("h")
  })

  test("type-to-focus: typing with panel focuses panel editor when last clicked", async ({ page }) => {
    const testId = Date.now().toString(36)
    const channelName = `focus-type-panel-${testId}`
    await createChannel(page, channelName)

    // Send a message and open thread
    await sendMessage(page, `Type panel test ${testId}`)

    const messageContainer = page
      .getByRole("main")
      .locator(".group")
      .filter({ hasText: `Type panel test ${testId}` })
      .first()
    await messageContainer.hover()
    const replyLink = messageContainer.getByRole("link", { name: "Reply in thread" })
    await expect(replyLink).toBeVisible({ timeout: 5000 })
    await replyLink.click()

    await expect(page.getByText(/Start a new thread/)).toBeVisible({ timeout: 3000 })

    // Click in the panel area to register it as last zone
    const panelEditor = page.locator("[data-editor-zone='panel'] [contenteditable='true']")
    await panelEditor.click()

    // Click the panel header to blur the editor (but stay in the panel zone)
    const panelHeader = page.getByTestId("panel").locator("header")
    await panelHeader.click()

    // Type a character — should focus the panel editor (last-clicked zone)
    await page.keyboard.press("x")

    await expect(panelEditor).toBeFocused({ timeout: 2000 })
    await expect(panelEditor).toContainText("x")
  })

  test("focus restores to zone editor after inline edit cancel", async ({ page }) => {
    const testId = Date.now().toString(36)
    const channelName = `focus-edit-${testId}`
    await createChannel(page, channelName)

    // Send a message from current user
    const messageText = `Edit restore test ${testId}`
    await sendMessage(page, messageText)

    // Open context menu and start editing
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()

    // Click the context menu trigger (the ... button)
    const menuTrigger = messageContainer.locator("[data-slot='dropdown-menu-trigger']")
    await expect(menuTrigger).toBeVisible({ timeout: 3000 })
    await menuTrigger.click()

    // Click Edit option
    const editOption = page.getByRole("menuitem", { name: "Edit" })
    await expect(editOption).toBeVisible({ timeout: 3000 })
    await editOption.click()

    // Verify edit form appeared
    const editEditor = page.locator("[data-inline-edit] [contenteditable='true']")
    await expect(editEditor).toBeVisible({ timeout: 3000 })

    // Cancel by pressing Escape
    await page.keyboard.press("Escape")

    // After cancel, the zone's message input editor should be focused
    const mainEditor = page.locator("[data-editor-zone='main'] [contenteditable='true']")
    await expect(mainEditor).toBeFocused({ timeout: 3000 })
  })
})
