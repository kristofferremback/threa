import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, createChannel, expectApiOk } from "./helpers"

/**
 * Regression test for the stream timeline bottom-spacing bug.
 *
 * The floating composer should never obscure the most recent message.
 * This verifies that Virtuoso's Footer spacer reserves enough scrollable
 * room and that the list re-scrolls when the composer height changes.
 */

test.describe("Stream composer bottom spacing", () => {
  test("last message is fully visible above the composer in a small stream", async ({ page }) => {
    const { testId } = await loginAndCreateWorkspace(page, "composer-spacing-test")
    const channelName = `small-stream-${testId}`
    await createChannel(page, channelName)

    const url = page.url()
    const workspaceMatch = url.match(/\/w\/([^/]+)/)
    const streamMatch = url.match(/\/s\/([^/?]+)/)
    if (!workspaceMatch || !streamMatch) throw new Error("Could not extract IDs")
    const workspaceId = workspaceMatch[1]
    const streamId = streamMatch[1]

    // Seed just enough messages to fill most of the viewport
    const prefix = `[${testId}]`
    for (let i = 1; i <= 15; i++) {
      await expectApiOk(
        await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
          data: { streamId, content: `${prefix} msg-${String(i).padStart(3, "0")}` },
        }),
        `Send message ${i}`
      )
    }

    await page.goto(`/w/${workspaceId}/s/${streamId}`)

    // Wait for the last message to be rendered
    const lastMessage = page
      .getByRole("main")
      .locator(".message-item")
      .filter({ hasText: `${prefix} msg-015` })
      .first()
    await expect(lastMessage).toBeVisible({ timeout: 10000 })

    // Poll until the last message sits above the composer (gives Virtuoso
    // time to measure the Footer spacer and re-scroll if needed).
    const composer = page.locator("[data-message-composer-root]").first()
    await expect
      .poll(
        async () => {
          const lastMessageBox = await lastMessage.boundingBox()
          const composerBox = await composer.boundingBox()
          if (!lastMessageBox || !composerBox) return Number.POSITIVE_INFINITY
          return lastMessageBox.y + lastMessageBox.height - composerBox.y
        },
        { timeout: 5000 }
      )
      .toBeLessThanOrEqual(2)
  })

  test("last message stays visible after composer grows from multi-line input", async ({ page }) => {
    const { testId } = await loginAndCreateWorkspace(page, "composer-spacing-test")
    const channelName = `grow-composer-${testId}`
    await createChannel(page, channelName)

    const { workspaceId, streamId } = (() => {
      const url = page.url()
      const workspaceMatch = url.match(/\/w\/([^/]+)/)
      const streamMatch = url.match(/\/s\/([^/?]+)/)
      if (!workspaceMatch || !streamMatch) throw new Error("Could not extract IDs")
      return { workspaceId: workspaceMatch[1], streamId: streamMatch[1] }
    })()

    // Seed messages so the stream is scrollable
    const prefix = `[${testId}]`
    for (let i = 1; i <= 10; i++) {
      await expectApiOk(
        await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
          data: { streamId, content: `${prefix} msg-${String(i).padStart(3, "0")}` },
        }),
        `Send message ${i}`
      )
    }

    await page.goto(`/w/${workspaceId}/s/${streamId}`)

    const lastMessage = page
      .getByRole("main")
      .locator(".message-item")
      .filter({ hasText: `${prefix} msg-010` })
      .first()
    await expect(lastMessage).toBeVisible({ timeout: 10000 })

    // Focus the composer and type several lines to make it grow
    const editor = page.locator("[contenteditable='true']").first()
    await editor.click()
    for (let i = 0; i < 5; i++) {
      await page.keyboard.type(`Line ${i + 1}`)
      await page.keyboard.press("Shift+Enter")
    }

    // Poll until the composer resize + re-scroll stabilises
    const composer = page.locator("[data-message-composer-root]").first()
    await expect
      .poll(
        async () => {
          const lastMessageBox = await lastMessage.boundingBox()
          const composerBox = await composer.boundingBox()
          if (!lastMessageBox || !composerBox) return Number.POSITIVE_INFINITY
          return lastMessageBox.y + lastMessageBox.height - composerBox.y
        },
        { timeout: 5000 }
      )
      .toBeLessThanOrEqual(2)
  })
})
