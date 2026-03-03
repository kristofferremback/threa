import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, loginInNewContext, createChannel, expectApiOk, generateTestId } from "./helpers"

/**
 * E2E tests for the "press ArrowUp in empty composer to edit last message" feature.
 *
 * The Cancel button is the sentinel: it is only rendered inside the inline edit form,
 * so its presence/absence reliably signals whether edit mode is open.
 */

test.describe("Edit last message (ArrowUp)", () => {
  // All tests use a desktop viewport — the feature is desktop-only.
  test.use({ viewport: { width: 1280, height: 800 } })

  test("does nothing when the composer has content", async ({ page }) => {
    await loginAndCreateWorkspace(page, "elm-nonempty")

    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

    const editor = page.locator("[contenteditable='true']")
    await editor.click()
    await page.keyboard.type("I am typing something")

    // ArrowUp with content in the editor should not open edit mode
    await page.keyboard.press("ArrowUp")

    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible()
    await expect(editor).toContainText("I am typing something")
  })

  test("opens the last message in edit mode when editor is empty", async ({ page }) => {
    await loginAndCreateWorkspace(page, "elm-basic")

    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

    const content = `Last message to edit ${Date.now()}`
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.type(content)
    await page.keyboard.press("Enter")

    await expect(page.getByRole("main").getByText(content)).toBeVisible({ timeout: 5000 })

    // Editor should be empty after sending
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.press("ArrowUp")

    // Inline edit form opens
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 3000 })
  })

  test("does nothing when the current user has no messages in the stream", async ({ page }) => {
    await loginAndCreateWorkspace(page, "elm-nomsg")

    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

    // No messages sent — press ArrowUp in empty editor
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.press("ArrowUp")

    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible()
  })

  test("scrolls off-screen message into view and opens edit", async ({ browser }) => {
    test.setTimeout(90000)
    const testId = generateTestId()
    const channelName = `elm-scroll-${testId}`

    // ── User A: create workspace + channel, send first message ──
    const userA = await loginInNewContext(browser, `elm-a-${testId}@example.com`, `ELM A ${testId}`)
    await userA.page.setViewportSize({ width: 1280, height: 500 })

    const createWsRes = await userA.page.request.post("/api/workspaces", {
      data: { name: `ELM Scroll ${testId}` },
    })
    await expectApiOk(createWsRes, "Create workspace")
    const { workspace } = (await createWsRes.json()) as { workspace: { id: string } }
    const workspaceId = workspace.id

    await userA.page.goto(`/w/${workspaceId}`)
    await expect(userA.page.getByRole("button", { name: "+ New Channel" })).toBeVisible({ timeout: 10000 })
    await createChannel(userA.page, channelName, { switchToAll: false })

    const streamMatch = userA.page.url().match(/\/s\/([^/?]+)/)
    expect(streamMatch).toBeTruthy()
    const streamId = streamMatch![1]

    const firstMessage = `First A message ${testId}`
    await userA.page.locator("[contenteditable='true']").click()
    await userA.page.keyboard.type(firstMessage)
    await userA.page.getByRole("button", { name: "Send" }).click()
    await expect(userA.page.getByRole("main").getByText(firstMessage)).toBeVisible({ timeout: 5000 })

    // ── User B: join, send many messages to push A's message off screen ──
    const userB = await loginInNewContext(browser, `elm-b-${testId}@example.com`, `ELM B ${testId}`)
    await userB.page.setViewportSize({ width: 1280, height: 500 })

    await userB.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, { data: { role: "user" } })
    await userB.page.goto(`/w/${workspaceId}`)
    await userB.page.request.post(`/api/dev/workspaces/${workspaceId}/streams/${streamId}/join`)
    await userB.page.goto(`/w/${workspaceId}/s/${streamId}`)
    await expect(userB.page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({
      timeout: 10000,
    })

    // Send 20 messages via API (much faster than UI interactions)
    const fillerText = `Filler B ${testId}`
    for (let i = 1; i <= 20; i++) {
      await userB.page.request.post(`/api/workspaces/${workspaceId}/messages`, {
        data: {
          streamId,
          contentJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: `${fillerText} #${i}` }] }],
          },
          contentMarkdown: `${fillerText} #${i}`,
        },
      })
    }

    // ── User A: wait for filler messages to arrive, then test ──
    await expect(userA.page.getByRole("main").getByText(`${fillerText} #20`).first()).toBeVisible({ timeout: 15000 })

    // Verify User A's first message has scrolled out of the visible area
    const firstMessageEl = userA.page.getByRole("main").getByText(firstMessage).first()
    await expect(firstMessageEl).not.toBeInViewport()

    // Press ArrowUp in the empty composer
    await userA.page.locator("[contenteditable='true']").click()
    await userA.page.keyboard.press("ArrowUp")

    // Inline edit form should open
    await expect(userA.page.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 5000 })
    // First message should now be scrolled into view
    await expect(firstMessageEl).toBeInViewport({ timeout: 5000 })

    await userA.context.close()
    await userB.context.close()
  })

  test("does nothing when the user's only message is outside the loaded bootstrap window", async ({ page }) => {
    test.setTimeout(60000)
    const { testId } = await loginAndCreateWorkspace(page, "elm-window")

    const workspaceId = page.url().match(/\/w\/([^/]+)/)?.[1]
    expect(workspaceId).toBeTruthy()

    // Open a scratchpad and send one message
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })

    const oldMessage = `Old message outside window ${testId}`
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.type(oldMessage)
    await page.keyboard.press("Enter")
    await expect(page.getByRole("main").getByText(oldMessage)).toBeVisible({ timeout: 5000 })

    // Wait for the draft to be promoted to a real stream (URL changes from draft_xxx to stream_xxx)
    await page.waitForURL(/\/s\/stream_/, { timeout: 10000 })
    const streamId = page.url().match(/\/s\/([^/?]+)/)?.[1]
    expect(streamId).toBeTruthy()

    // Flood the stream with 60 messages via API to push the first message outside the 50-event bootstrap window
    for (let i = 1; i <= 60; i++) {
      await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
        data: {
          streamId,
          contentJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: `Filler ${i}` }] }],
          },
          contentMarkdown: `Filler ${i}`,
        },
      })
    }

    // Reload so bootstrap loads only the 50 most recent events (the old message is no longer included)
    await page.reload()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 10000 })

    // The old message should not be visible in the UI after reload
    await expect(page.getByRole("main").getByText(oldMessage)).not.toBeVisible()

    // Press ArrowUp — the old message is not registered (not mounted), so nothing happens
    await page.locator("[contenteditable='true']").click()
    await page.keyboard.press("ArrowUp")

    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible()
  })
})
