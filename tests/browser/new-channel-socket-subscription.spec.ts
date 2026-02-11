import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"

/**
 * Tests that newly created channels receive real-time socket events.
 *
 * Bug: When a user creates a channel, it appears in the sidebar but the
 * client doesn't join the Socket.io room for it. Messages from other users
 * don't update the unread counter or preview until a page refresh.
 */

interface UserSession {
  context: BrowserContext
  page: Page
}

async function loginAs(browser: Browser, email: string, name: string): Promise<UserSession> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto("/login")
  await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Name").fill(name)
  await page.getByRole("button", { name: "Sign In" }).click()
  await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

  return { context, page }
}

test.describe("New Channel Socket Subscription", () => {
  const testId = Date.now().toString(36)

  test("should receive real-time events for a newly created channel without refresh", async ({ browser }) => {
    test.setTimeout(60000)

    const userAEmail = `creator-${testId}@example.com`
    const userAName = `Creator ${testId}`
    const userBEmail = `joiner-${testId}@example.com`
    const userBName = `Joiner ${testId}`
    const channelName = `realtime-${testId}`

    // ──── User A: Create workspace and channel ────

    const userA = await loginAs(browser, userAEmail, userAName)

    // Create workspace
    await userA.page.getByPlaceholder("New workspace name").fill(`Socket Sub Test ${testId}`)
    await userA.page.getByRole("button", { name: "Create Workspace" }).click()
    await expect(userA.page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })

    const workspaceMatch = userA.page.url().match(/\/w\/([^/]+)/)
    expect(workspaceMatch).toBeTruthy()
    const workspaceId = workspaceMatch![1]

    // Create a channel
    userA.page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await userA.page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(userA.page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    // Grab the stream ID from the URL
    const streamMatch = userA.page.url().match(/\/s\/([^/?]+)/)
    expect(streamMatch).toBeTruthy()
    const streamId = streamMatch![1]

    // Send a message so there's something in the channel
    await userA.page.locator("[contenteditable='true']").click()
    await userA.page.keyboard.type("Anyone here?")
    await userA.page.getByRole("button", { name: "Send" }).click()
    await expect(userA.page.getByRole("main").getByText("Anyone here?")).toBeVisible({ timeout: 5000 })

    // Navigate away to a scratchpad via quick switcher (User A is no longer viewing the channel)
    await userA.page.keyboard.press("Meta+k")
    await expect(userA.page.getByRole("dialog")).toBeVisible()
    await userA.page.keyboard.type("> New Scratchpad")
    await userA.page.keyboard.press("Enter")
    await expect(userA.page.getByRole("main").getByText(/Type a message|No messages yet/)).toBeVisible({
      timeout: 5000,
    })

    // Verify the channel link is visible in sidebar (Recent view)
    await expect(userA.page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })

    // ──── User B: Join workspace and channel, send a message ────

    const userB = await loginAs(browser, userBEmail, userBName)

    // Join workspace via dev endpoint
    const joinWorkspaceRes = await userB.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
      data: { role: "member" },
    })
    expect(joinWorkspaceRes.ok()).toBeTruthy()

    // Navigate to workspace so workspace member middleware picks up
    await userB.page.goto(`/w/${workspaceId}`)
    await expect(userB.page.getByText("Select a stream from the sidebar")).toBeVisible({ timeout: 10000 })

    // Join the channel via dev endpoint
    const joinStreamRes = await userB.page.request.post(`/api/dev/workspaces/${workspaceId}/streams/${streamId}/join`)
    expect(joinStreamRes.ok()).toBeTruthy()

    // Send a message via API (markdown format)
    const testMessage = `Reply from User B ${Date.now()}`
    const sendRes = await userB.page.request.post(`/api/workspaces/${workspaceId}/messages`, {
      data: {
        streamId,
        content: testMessage,
      },
    })
    expect(sendRes.status()).toBe(201)

    // ──── User A: Should see unread badge without refresh ────

    const channelLink = userA.page.getByRole("link", { name: `#${channelName}` })

    // The unread badge (a span with bg-primary class inside the channel link)
    // should appear with count "1" — without refreshing
    await expect
      .poll(
        async () => {
          const badge = channelLink.locator("span.rounded-full")
          const count = await badge.count()
          if (count === 0) return null
          return badge.first().textContent()
        },
        { timeout: 10000, message: "Unread badge should appear on the channel link without refresh" }
      )
      .toBe("1")

    // Click the channel to verify the message is there and badge clears
    await channelLink.click()
    await expect(userA.page.getByRole("main").getByText(testMessage)).toBeVisible({ timeout: 5000 })

    // Cleanup
    await userA.context.close()
    await userB.context.close()
  })

  test("should update message preview for a newly created channel without refresh", async ({ browser }) => {
    test.setTimeout(60000)

    const userAEmail = `preview-creator-${testId}@example.com`
    const userAName = `PreviewCreator ${testId}`
    const userBEmail = `preview-joiner-${testId}@example.com`
    const userBName = `PreviewJoiner ${testId}`
    const channelName = `preview-rt-${testId}`

    // ──── User A: Create workspace and channel ────

    const userA = await loginAs(browser, userAEmail, userAName)

    await userA.page.getByPlaceholder("New workspace name").fill(`Preview Sub Test ${testId}`)
    await userA.page.getByRole("button", { name: "Create Workspace" }).click()
    await expect(userA.page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })

    const workspaceMatch = userA.page.url().match(/\/w\/([^/]+)/)
    const workspaceId = workspaceMatch![1]

    // Create channel
    userA.page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await userA.page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(userA.page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })

    const streamMatch = userA.page.url().match(/\/s\/([^/?]+)/)
    const streamId = streamMatch![1]

    // Navigate away via quick switcher
    await userA.page.keyboard.press("Meta+k")
    await expect(userA.page.getByRole("dialog")).toBeVisible()
    await userA.page.keyboard.type("> New Scratchpad")
    await userA.page.keyboard.press("Enter")
    await expect(userA.page.getByRole("main").getByText(/Type a message|No messages yet/)).toBeVisible({
      timeout: 5000,
    })

    // ──── User B: Join and send a message ────

    const userB = await loginAs(browser, userBEmail, userBName)

    await userB.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
      data: { role: "member" },
    })
    await userB.page.goto(`/w/${workspaceId}`)
    await expect(userB.page.getByText("Select a stream from the sidebar")).toBeVisible({ timeout: 10000 })

    await userB.page.request.post(`/api/dev/workspaces/${workspaceId}/streams/${streamId}/join`)

    const previewMessage = `Preview check ${Date.now()}`
    const sendRes = await userB.page.request.post(`/api/workspaces/${workspaceId}/messages`, {
      data: { streamId, content: previewMessage },
    })
    expect(sendRes.status()).toBe(201)

    // ──── User A: Should see preview text update without refresh ────

    const channelLink = userA.page.getByRole("link", { name: `#${channelName}` })

    await expect
      .poll(
        async () => {
          const previewText = await channelLink.locator("span.truncate").textContent()
          return previewText?.includes("Preview check") ?? false
        },
        { timeout: 10000, message: "Message preview should update in sidebar without refresh" }
      )
      .toBe(true)

    await userA.context.close()
    await userB.context.close()
  })
})
