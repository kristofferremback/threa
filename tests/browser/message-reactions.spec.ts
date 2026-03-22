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
    await expect(messageContainer.getByText("🔥")).toBeVisible({ timeout: 5000 })
    await expect(messageContainer.getByText("1")).toBeVisible()
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
      await ctxB.page.goto(`/w/${workspaceId}/stream/${streamId}`)
      await expect(ctxB.page.getByRole("main").getByText(messageContent)).toBeVisible({ timeout: 10000 })

      // User A: add a reaction via API
      const reactRes = await ctxA.page.request.post(`/api/workspaces/${workspaceId}/messages/${message.id}/reactions`, {
        data: { emoji: "👍" },
      })
      expect(reactRes.ok()).toBeTruthy()

      // User B: should see the reaction pill appear in real-time
      const messageContainer = ctxB.page.getByRole("main").locator(".group").filter({ hasText: messageContent }).first()
      await expect(messageContainer.getByText("👍")).toBeVisible({ timeout: 10000 })
      await expect(messageContainer.getByText("1")).toBeVisible({ timeout: 5000 })
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
