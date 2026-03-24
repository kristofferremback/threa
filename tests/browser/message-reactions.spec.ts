import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { loginAndCreateWorkspace, createChannel, loginInNewContext, waitForWorkspaceProvisioned } from "./helpers"

/**
 * Message reaction E2E tests.
 *
 * Tests:
 * 1. Add a reaction via the emoji picker in the message toolbar
 * 2. Reaction pill appears below the message with count
 * 3. Toggle reaction off by clicking the pill
 * 4. Multi-user: User B sees User A's reaction in real-time via socket
 * 5. Emoji picker search filters results
 */

test.describe("Message Reactions", () => {
  test("should add a reaction via toolbar emoji picker and display pill", async ({ page }) => {
    await loginAndCreateWorkspace(page, "react")
    const testId = Date.now().toString(36)
    const channelName = `react-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Reaction test ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Hover over the message to reveal toolbar
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()

    // Click the "Add reaction" button (SmilePlus icon)
    const reactionButton = messageContainer.getByRole("button", { name: "Add reaction" })
    await expect(reactionButton).toBeVisible({ timeout: 3000 })
    await reactionButton.click()

    // Emoji picker popover should open with a search input
    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })

    // Search for "fire" emoji
    await searchInput.fill("fire")

    // Click the first emoji result (🔥)
    const emojiButton = page.locator("button[aria-label=':fire:']")
    await expect(emojiButton).toBeVisible({ timeout: 2000 })
    await emojiButton.click()

    // Popover should close
    await expect(searchInput).not.toBeVisible()

    // Reaction pill should appear below the message with count "1"
    const reactionPill = messageContainer.locator("button").filter({ hasText: "🔥" }).first()
    await expect(reactionPill).toBeVisible({ timeout: 5000 })
    await expect(reactionPill).toContainText("1")
  })

  test("should toggle reaction off by clicking the pill", async ({ page }) => {
    await loginAndCreateWorkspace(page, "toggle")
    const testId = Date.now().toString(36)
    const channelName = `toggle-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Toggle test ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Add a reaction via toolbar
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()
    await messageContainer.getByRole("button", { name: "Add reaction" }).click()

    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })
    await searchInput.fill("heart")
    const heartButton = page.locator("button[aria-label=':heart:']")
    await expect(heartButton).toBeVisible({ timeout: 2000 })
    await heartButton.click()

    // Wait for reaction pill to appear
    const reactionPill = messageContainer.locator("button").filter({ hasText: "❤️" }).first()
    await expect(reactionPill).toBeVisible({ timeout: 5000 })

    // Click the pill to toggle off
    await reactionPill.click()

    // Reaction pill should disappear (count drops to 0 → removed)
    await expect(reactionPill).not.toBeVisible({ timeout: 5000 })
  })

  test("should show reaction from another user in real-time", async ({ browser }) => {
    test.setTimeout(60000)

    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const userAEmail = `reactor-a-${testId}@example.com`
    const userAName = `Reactor A ${testId}`
    const userBEmail = `reactor-b-${testId}@example.com`
    const userBName = `Reactor B ${testId}`

    // User A: create workspace + channel via API
    const ctxA = await loginInNewContext(browser, userAEmail, userAName)
    let ctxB: { context: BrowserContext; page: Page } | undefined

    try {
      const createWsRes = await ctxA.page.request.post("/api/workspaces", {
        data: { name: `React Test ${testId}`, slug: `react-${testId}` },
      })
      expect(createWsRes.ok()).toBeTruthy()
      const { workspace } = (await createWsRes.json()) as { workspace: { id: string } }
      const workspaceId = workspace.id
      await waitForWorkspaceProvisioned(ctxA.page, workspaceId)

      const channelSlug = `reactions-${testId}`
      const createStreamRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/streams`, {
        data: { type: "channel", slug: channelSlug, visibility: "public" },
      })
      expect(createStreamRes.ok()).toBeTruthy()
      const { stream } = (await createStreamRes.json()) as { stream: { id: string } }
      const streamId = stream.id

      // User B: join workspace + channel, open in browser
      ctxB = await loginInNewContext(browser, userBEmail, userBName)
      const joinWsRes = await ctxB.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
        data: { role: "user" },
      })
      expect(joinWsRes.ok()).toBeTruthy()

      const joinStreamRes = await ctxB.page.request.post(`/api/dev/workspaces/${workspaceId}/streams/${streamId}/join`)
      expect(joinStreamRes.ok()).toBeTruthy()

      // User A: send a message via API
      const messageContent = `React this ${testId}`
      const sendRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/messages`, {
        data: { streamId, content: messageContent },
      })
      expect(sendRes.ok()).toBeTruthy()
      const { message } = (await sendRes.json()) as { message: { id: string } }

      // User B: open the channel in browser
      await ctxB.page.goto(`/w/${workspaceId}/s/${streamId}`)
      await expect(ctxB.page.getByRole("main").getByText(messageContent)).toBeVisible({ timeout: 10000 })

      // User A: add a reaction via API
      const reactRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/messages/${message.id}/reactions`, {
        data: { emoji: "👍" },
      })
      expect(reactRes.ok()).toBeTruthy()

      // User B: should see the reaction pill appear in real-time
      const messageContainer = ctxB.page.getByRole("main").locator(".group").filter({ hasText: messageContent }).first()
      const reactionPill = messageContainer.locator("button").filter({ hasText: "👍" }).first()
      await expect(reactionPill).toBeVisible({ timeout: 10000 })
      await expect(reactionPill).toContainText("1")
    } finally {
      await ctxA.context.close()
      await ctxB?.context.close()
    }
  })

  test("reaction from another user should not trigger unread divider", async ({ browser }) => {
    test.setTimeout(60000)

    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const userAEmail = `unread-a-${testId}@example.com`
    const userAName = `Unread A ${testId}`
    const userBEmail = `unread-b-${testId}@example.com`
    const userBName = `Unread B ${testId}`

    const ctxA = await loginInNewContext(browser, userAEmail, userAName)
    let ctxB: { context: BrowserContext; page: Page } | undefined

    try {
      // User A: create workspace + channel
      const createWsRes = await ctxA.page.request.post("/api/workspaces", {
        data: { name: `Unread Test ${testId}`, slug: `unread-${testId}` },
      })
      expect(createWsRes.ok()).toBeTruthy()
      const { workspace } = (await createWsRes.json()) as { workspace: { id: string } }
      const workspaceId = workspace.id
      await waitForWorkspaceProvisioned(ctxA.page, workspaceId)

      const channelSlug = `unread-react-${testId}`
      const createStreamRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/streams`, {
        data: { type: "channel", slug: channelSlug, visibility: "public" },
      })
      expect(createStreamRes.ok()).toBeTruthy()
      const { stream } = (await createStreamRes.json()) as { stream: { id: string } }
      const streamId = stream.id

      // User B: join workspace + channel
      ctxB = await loginInNewContext(browser, userBEmail, userBName)
      const joinWsRes = await ctxB.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
        data: { role: "user" },
      })
      expect(joinWsRes.ok()).toBeTruthy()
      const joinStreamRes = await ctxB.page.request.post(`/api/dev/workspaces/${workspaceId}/streams/${streamId}/join`)
      expect(joinStreamRes.ok()).toBeTruthy()

      // User A: send a message
      const messageContent = `Unread divider test ${testId}`
      const sendRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/messages`, {
        data: { streamId, content: messageContent },
      })
      expect(sendRes.ok()).toBeTruthy()
      const { message } = (await sendRes.json()) as { message: { id: string } }

      // User B: open the channel and read the message (marks as read)
      await ctxB.page.goto(`/w/${workspaceId}/s/${streamId}`)
      await expect(ctxB.page.getByRole("main").getByText(messageContent)).toBeVisible({ timeout: 10000 })

      // Wait for auto-mark-as-read to fire (500ms debounce + buffer)
      await ctxB.page.waitForTimeout(1500)

      // User B: navigate away
      await ctxB.page.goto(`/w/${workspaceId}`)
      await expect(ctxB.page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible({ timeout: 10000 })

      // User A: add a reaction to the message while User B is away
      const reactRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/messages/${message.id}/reactions`, {
        data: { emoji: "👍" },
      })
      expect(reactRes.ok()).toBeTruthy()

      // User B: navigate back to the channel
      await ctxB.page.goto(`/w/${workspaceId}/s/${streamId}`)
      await expect(ctxB.page.getByRole("main").getByText(messageContent)).toBeVisible({ timeout: 10000 })

      // The reaction should be visible
      const messageContainer = ctxB.page.getByRole("main").locator(".group").filter({ hasText: messageContent }).first()
      await expect(messageContainer.locator("button").filter({ hasText: "👍" }).first()).toBeVisible({ timeout: 10000 })

      // The "New" unread divider should NOT appear — reactions are not new messages
      const unreadDivider = ctxB.page.getByRole("main").getByText("New", { exact: true })
      await expect(unreadDivider).not.toBeVisible({ timeout: 3000 })
    } finally {
      await ctxA.context.close()
      await ctxB?.context.close()
    }
  })

  test("should filter emojis in reaction picker search", async ({ page }) => {
    await loginAndCreateWorkspace(page, "search")
    const testId = Date.now().toString(36)
    const channelName = `search-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Search test ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Open reaction picker
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()
    await messageContainer.getByRole("button", { name: "Add reaction" }).click()

    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })

    // Search for a nonsense query — should show "No emojis found"
    await searchInput.fill("xyznonexistent")
    await expect(page.getByText("No emojis found")).toBeVisible({ timeout: 2000 })

    // Clear and search for "thumbsup" — should show matching emoji
    await searchInput.fill("thumbsup")
    const thumbsButton = page.locator("button[aria-label=':+1:']")
    await expect(thumbsButton).toBeVisible({ timeout: 2000 })
  })

  test("should render emoji grid with visible emojis on open", async ({ page }) => {
    await loginAndCreateWorkspace(page, "grid")
    const testId = Date.now().toString(36)
    const channelName = `grid-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Grid test ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Open reaction picker
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()
    await messageContainer.getByRole("button", { name: "Add reaction" }).click()

    // Search input should be visible and focused
    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })
    await expect(searchInput).toBeFocused()

    // Emoji buttons should be visible in the grid (not empty)
    const emojiButtons = page.locator("[role='listbox'] button[role='option']")
    await expect(emojiButtons.first()).toBeVisible({ timeout: 3000 })

    // First emoji should be selected by default
    await expect(emojiButtons.first()).toHaveAttribute("data-selected", "true")

    // Footer should show the selected emoji shortcode
    const footer = page.locator(".border-t .font-mono")
    await expect(footer).toBeVisible()
  })

  test("should navigate emoji grid with arrow keys and select with Enter", async ({ page }) => {
    await loginAndCreateWorkspace(page, "keynav")
    const testId = Date.now().toString(36)
    const channelName = `keynav-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Keynav test ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Open reaction picker
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()
    await messageContainer.getByRole("button", { name: "Add reaction" }).click()

    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })

    // Wait for emoji grid to render
    const emojiButtons = page.locator("[role='listbox'] button[role='option']")
    await expect(emojiButtons.first()).toBeVisible({ timeout: 3000 })

    // First item should be selected
    await expect(emojiButtons.first()).toHaveAttribute("data-selected", "true")

    // Press ArrowRight to move to second item
    await page.keyboard.press("ArrowRight")
    await expect(emojiButtons.nth(1)).toHaveAttribute("data-selected", "true")
    await expect(emojiButtons.first()).not.toHaveAttribute("data-selected", "true")

    // Press ArrowLeft to go back
    await page.keyboard.press("ArrowLeft")
    await expect(emojiButtons.first()).toHaveAttribute("data-selected", "true")

    // Type a search query — characters should go into search input
    await page.keyboard.type("rocket")
    await expect(searchInput).toHaveValue("rocket")

    // Press Enter to select the first filtered result
    await page.keyboard.press("Enter")

    // Popover should close and reaction pill should appear
    await expect(searchInput).not.toBeVisible()
    await expect(messageContainer.getByText("🚀")).toBeVisible({ timeout: 5000 })
  })

  test("should close emoji picker with Escape", async ({ page }) => {
    await loginAndCreateWorkspace(page, "esc")
    const testId = Date.now().toString(36)
    const channelName = `esc-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Escape test ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Open reaction picker
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()
    await messageContainer.getByRole("button", { name: "Add reaction" }).click()

    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })

    // Press Escape
    await page.keyboard.press("Escape")

    // Popover should close
    await expect(searchInput).not.toBeVisible()
  })

  test("should show inline + button to add more reactions when reactions exist", async ({ page }) => {
    await loginAndCreateWorkspace(page, "inline")
    const testId = Date.now().toString(36)
    const channelName = `inline-${testId}`
    await createChannel(page, channelName)

    // Send a message
    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    const messageText = `Inline add ${testId}`
    await page.keyboard.type(messageText)
    await page.keyboard.press("Meta+Enter")
    await expect(page.getByRole("main").getByText(messageText)).toBeVisible({ timeout: 5000 })

    // Add first reaction via toolbar
    const messageContainer = page.getByRole("main").locator(".group").filter({ hasText: messageText }).first()
    await messageContainer.hover()
    await messageContainer.getByRole("button", { name: "Add reaction" }).click()
    const searchInput = page.getByPlaceholder("Search emoji...")
    await expect(searchInput).toBeVisible({ timeout: 2000 })
    await searchInput.fill("fire")
    await page.locator("button[aria-label=':fire:']").click()

    // Wait for reaction pill
    await expect(messageContainer.getByText("🔥")).toBeVisible({ timeout: 5000 })

    // The inline "Add reaction" + button should also appear next to the pills
    const inlineAddButtons = messageContainer.getByRole("button", { name: "Add reaction" })
    // Should have at least the inline one (toolbar one may be hidden since we're not hovering)
    await expect(inlineAddButtons.first()).toBeVisible({ timeout: 3000 })
  })
})
