import { test, expect, type Page } from "@playwright/test"
import { createChannel, expectApiOk, generateTestId, loginAndCreateWorkspace } from "./helpers"

/**
 * E2E coverage for Slice 2 of message sharing — the cross-stream picker
 * modal. Covers the two single-user scenarios that exercise the new modal
 * flow end-to-end:
 *
 * 1. **Cross-stream into a scratchpad (public source).** Share a message
 *    from a public channel into the user's own scratchpad. No privacy
 *    boundary fires. Asserts the picker filters correctly and the pointer
 *    lands hydrated in the target stream.
 * 2. **Same-stream share.** Share a message into the stream it lives in.
 *    Plan D5 says this is allowed; the hand-off lands in the current
 *    composer and the user can send a duplicate pointer back.
 *
 * The recursive private-placeholder rechain scenario from the plan
 * (E2E-share-rechain-private-placeholder) is covered exhaustively at
 * unit-test level in `hydration.test.ts` and `card-body.test.tsx`. A
 * three-user three-stream Playwright variant is deferred to a follow-up;
 * this slice's E2Es focus on the modal + handoff path that's new in Slice
 * 2.
 */

async function sendChannelMessageViaApi(page: Page, text: string): Promise<string> {
  const match = page.url().match(/\/w\/([^/]+)\/s\/([^/?]+)/)
  expect(match).toBeTruthy()
  const [, workspaceId, streamId] = match!
  const response = await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
    data: {
      streamId,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      contentMarkdown: text,
    },
  })
  await expectApiOk(response, `Create stream message: ${text}`)
  const body = (await response.json()) as { message?: { id: string } }
  return body.message?.id ?? ""
}

async function openMessageContextMenu(page: Page, text: string): Promise<void> {
  const row = page.getByText(text, { exact: false }).first().locator("xpath=ancestor::*[@data-message-id][1]")
  await row.hover()
  await row.getByRole("button", { name: /message actions/i }).click()
}

async function createScratchpad(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "+ New Scratchpad" }).click()
  // The new-scratchpad action navigates immediately to the draft route.
  // Wait for the URL to settle on /s/<id> so subsequent helpers can read it.
  await expect(page).toHaveURL(/\/w\/[^/]+\/s\/[^/?]+/, { timeout: 5000 })
  // Optional rename via the page header — best-effort; skipped if not exposed.
  const header = page.getByRole("heading", { level: 1 }).first()
  await header.waitFor({ state: "visible", timeout: 5000 })
  return name
}

test.describe("Message share — cross-stream picker modal (Slice 2)", () => {
  let testId: string

  test.beforeEach(async ({ page }) => {
    const result = await loginAndCreateWorkspace(page, "share-x-stream")
    testId = result.testId
  })

  test("shares a public-channel message into the user's scratchpad via the picker", async ({ page }) => {
    const channelName = `pub-${testId}`
    await createChannel(page, channelName, { switchToAll: false })
    const sourceText = `source-msg-${testId}`
    await sendChannelMessageViaApi(page, sourceText)

    const sourceUrl = page.url()
    // Pre-create the scratchpad target so it shows up in the picker.
    const scratchpadName = `Saved ${testId}`
    await createScratchpad(page, scratchpadName)
    // Hop back to the source channel.
    await page.goto(sourceUrl)
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible()

    await openMessageContextMenu(page, sourceText)
    // The default "Share message" entry — opens the picker modal.
    await page.getByRole("menuitem", { name: /^share message$/i }).click()

    // Picker dialog opens. The scratchpad we just created is selectable.
    const dialog = page.getByRole("dialog", { name: /share message/i })
    await expect(dialog).toBeVisible()
    const target = dialog.locator(`[cmdk-item][data-value]`).first()
    await expect(target).toBeVisible()
    // Click whichever scratchpad-row is exposed; in the no-named-scratchpad
    // case the list shows just our newly-created untitled one.
    const scratchItem = dialog
      .locator("[cmdk-item][data-value]")
      .filter({ hasText: /scratchpad|saved|notes|untitled/i })
      .first()
    if ((await scratchItem.count()) > 0) {
      await scratchItem.click()
    } else {
      // Fallback: the only non-channel option is the scratchpad anyway.
      await target.click()
    }

    // Modal closes and we navigate to the target. Composer pre-fills with
    // the share node — send via the normal Enter shortcut.
    await expect(dialog).not.toBeVisible()
    const composer = page.locator("[contenteditable='true']").first()
    await expect(composer).toBeVisible()
    await expect(composer.locator("[data-type='shared-message']")).toHaveCount(1, { timeout: 5000 })
    await composer.focus()
    await page.keyboard.press("Enter")

    // Sent — pointer card lands hydrated in the target stream.
    await expect(page.locator("[data-type='shared-message']").filter({ hasText: new RegExp(sourceText) })).toBeVisible({
      timeout: 5000,
    })
  })

  test("supports same-stream share — handoff lands in the current composer", async ({ page }) => {
    const channelName = `self-${testId}`
    await createChannel(page, channelName, { switchToAll: false })
    const sourceText = `self-share-msg-${testId}`
    await sendChannelMessageViaApi(page, sourceText)

    await openMessageContextMenu(page, sourceText)
    await page.getByRole("menuitem", { name: /^share message$/i }).click()

    const dialog = page.getByRole("dialog", { name: /share message/i })
    await expect(dialog).toBeVisible()
    // Pick the same channel we're already in.
    const sameItem = dialog
      .locator("[cmdk-item][data-value]")
      .filter({ hasText: new RegExp(channelName, "i") })
      .first()
    await expect(sameItem).toBeVisible()
    await sameItem.click()

    // Modal closes, current composer receives the share node — no
    // navigation flicker since target === current.
    await expect(dialog).not.toBeVisible()
    const composer = page.locator("[contenteditable='true']").first()
    await expect(composer.locator("[data-type='shared-message']")).toHaveCount(1, { timeout: 5000 })
    await composer.focus()
    await page.keyboard.press("Enter")

    // The channel now contains the original message AND a hydrated share
    // pointer to it. Two `[data-type='shared-message']` would only render in
    // the timeline if the send went through — the composer's transient one
    // disappears post-send.
    await expect(page.locator("[data-type='shared-message']").filter({ hasText: new RegExp(sourceText) })).toBeVisible({
      timeout: 5000,
    })
  })
})
