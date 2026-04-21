import { test, expect } from "@playwright/test"
import { expectApiOk, generateTestId, loginInNewContext, waitForWorkspaceProvisioned } from "./helpers"

/**
 * /invite command E2E tests.
 *
 * Tests that the @mention dropdown in /invite context:
 * 1. Shows users who are NOT already channel members
 * 2. Hides users who ARE already channel members
 * 3. Hides @channel and @here (not inviteable)
 * 4. Updates after a successful invite
 */

async function createWorkspaceAndChannel(page: import("@playwright/test").Page, prefix: string) {
  const testId = generateTestId()
  const email = `${prefix}-${testId}@example.com`
  const name = `${prefix} ${testId}`

  await expectApiOk(await page.request.post("/api/dev/login", { data: { email, name } }), "Stub auth login")

  const wsRes = await page.request.post("/api/workspaces", {
    data: { name: `${prefix} WS ${testId}` },
  })
  await expectApiOk(wsRes, "Workspace creation")
  const { workspace } = (await wsRes.json()) as { workspace: { id: string } }
  const workspaceId = workspace.id
  await waitForWorkspaceProvisioned(page, workspaceId)

  const channelSlug = `invite-${testId}`
  const streamRes = await page.request.post(`/api/workspaces/${workspaceId}/streams`, {
    data: { type: "channel", slug: channelSlug, visibility: "public" },
  })
  await expectApiOk(streamRes, "Create public channel")
  const { stream } = (await streamRes.json()) as { stream: { id: string } }

  return { testId, workspaceId, streamId: stream.id, channelSlug, email, name }
}

test.describe("Invite command", () => {
  test("should filter @mentions to non-members and exclude broadcasts", async ({ browser }) => {
    test.setTimeout(60000)

    const ctxA = await loginInNewContext(browser, `inviter-${Date.now()}@example.com`, "Inviter")
    let ctxB: Awaited<ReturnType<typeof loginInNewContext>> | undefined

    try {
      const { workspaceId, streamId, channelSlug } = await createWorkspaceAndChannel(ctxA.page, "invite")

      // ──── User B: Join workspace but NOT the channel ────
      ctxB = await loginInNewContext(browser, `invitee-${Date.now()}@example.com`, "Invitee")
      const joinRes = await ctxB.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
        data: { role: "user" },
      })
      await expectApiOk(joinRes, "User B joins workspace")
      const { user: userB } = (await joinRes.json()) as { user: { id: string; slug: string; name: string } }

      // ──── User A: Navigate to channel and open /invite ────
      await ctxA.page.goto(`/w/${workspaceId}/s/${streamId}`)
      await expect(ctxA.page.getByRole("heading", { name: `#${channelSlug}`, level: 1 })).toBeVisible({
        timeout: 10000,
      })

      const editor = ctxA.page.locator("[contenteditable='true']")
      await editor.click()

      // Type /inv to trigger command dropdown, then select /invite
      await ctxA.page.keyboard.type("/inv")
      const commandPopup = ctxA.page.locator("[aria-label='Slash command suggestions']")
      await expect(commandPopup).toBeVisible({ timeout: 5000 })
      await commandPopup.getByRole("option", { name: /invite/ }).click()

      // Type @ to trigger mention suggestions
      await ctxA.page.keyboard.type("@")
      await ctxA.page.waitForTimeout(300)

      // The mention suggestion popup should appear
      const suggestionPopup = ctxA.page.locator("[aria-label='Mention suggestions']")
      await expect(suggestionPopup).toBeVisible({ timeout: 5000 })

      // ──── Assert: User B (non-member) SHOULD be visible ────
      await expect(suggestionPopup.getByRole("option", { name: new RegExp(userB.name) })).toBeVisible({ timeout: 5000 })

      // ──── Assert: @channel and @here should NOT be visible ────
      await expect(suggestionPopup.getByRole("option", { name: /Channel/ })).not.toBeVisible({ timeout: 2000 })
      await expect(suggestionPopup.getByRole("option", { name: /Here/ })).not.toBeVisible({ timeout: 2000 })

      // ──── User A: Select User B from dropdown and send invite ────
      await suggestionPopup.getByRole("option", { name: new RegExp(userB.name) }).click()

      // Click the send button instead of pressing Enter to avoid any keyboard
      // handling race conditions with the suggestion popup.
      await ctxA.page.getByRole("button", { name: "Send" }).click()

      // Wait for command to execute and member_added event to appear
      await expect(ctxA.page.getByText("was added to the conversation")).toBeVisible({ timeout: 20000 })

      // ──── User A: Try /invite again ────
      await editor.click()
      await ctxA.page.keyboard.type("/inv")
      await expect(commandPopup).toBeVisible({ timeout: 5000 })
      await commandPopup.getByRole("option", { name: /invite/ }).click()
      await ctxA.page.keyboard.type("@")
      await ctxA.page.waitForTimeout(300)

      await expect(suggestionPopup).toBeVisible({ timeout: 5000 })

      // ──── Assert: User B should NO LONGER appear (now a member) ────
      await expect(suggestionPopup.getByRole("option", { name: new RegExp(userB.name) })).not.toBeVisible({
        timeout: 5000,
      })
    } finally {
      await ctxA.context.close()
      if (ctxB) await ctxB.context.close()
    }
  })
})
