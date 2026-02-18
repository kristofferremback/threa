import { test, expect } from "@playwright/test"
import { loginAndCreateWorkspace, loginInNewContext, createDmDraftId } from "./helpers"

test.describe("DM Lazy Creation", () => {
  test("should convert a draft DM to a real stream on first message", async ({ browser }) => {
    test.setTimeout(60000)

    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const inviteeEmail = `dm-invitee-${testId}@example.com`
    const inviteeName = `DM Invitee ${testId}`

    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    const invitee = await loginInNewContext(browser, inviteeEmail, inviteeName)

    try {
      await loginAndCreateWorkspace(ownerPage, "dm-lazy")

      const workspaceId = ownerPage.url().match(/\/w\/([^/]+)/)?.[1]
      expect(workspaceId).toBeTruthy()

      const joinWorkspaceResponse = await invitee.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
        data: { role: "member" },
      })
      expect(joinWorkspaceResponse.ok()).toBeTruthy()

      const membersResponse = await ownerPage.request.get(`/api/workspaces/${workspaceId}/members`)
      expect(membersResponse.ok()).toBeTruthy()
      const membersBody = (await membersResponse.json()) as { members: Array<{ id: string; email: string }> }
      const inviteeMember = membersBody.members.find((member) => member.email === inviteeEmail)
      expect(inviteeMember).toBeTruthy()

      const draftStreamId = createDmDraftId(inviteeMember!.id)
      await ownerPage.goto(`/w/${workspaceId}/s/${draftStreamId}`)

      const firstMessage = `First DM message ${testId}`
      await ownerPage.locator("[contenteditable='true']").click()
      await ownerPage.keyboard.type(firstMessage)
      await ownerPage.getByRole("button", { name: "Send" }).click()

      await expect(ownerPage).toHaveURL(new RegExp(`/w/${workspaceId}/s/stream_`), { timeout: 10000 })
      await expect(ownerPage.getByRole("main").getByText(firstMessage)).toBeVisible({ timeout: 5000 })

      const streamId = ownerPage.url().match(/\/s\/([^/?]+)/)?.[1]
      expect(streamId).toBeTruthy()
      expect(streamId).not.toBe(draftStreamId)

      await expect(ownerPage.locator(`a[href="/w/${workspaceId}/s/${draftStreamId}"]`)).toHaveCount(0)
      await expect(ownerPage.locator(`a[href="/w/${workspaceId}/s/${streamId}"]`).first()).toBeVisible({
        timeout: 5000,
      })

      // Verify invitee sees the DM in their sidebar after navigating to the workspace.
      // Bootstrap on navigation includes the DM stream created above. Wait directly for
      // the DM link — the invitee already has streams so the empty-state button never shows.
      await invitee.page.goto(`/w/${workspaceId}`)
      await expect(invitee.page.locator(`a[href="/w/${workspaceId}/s/${streamId}"]`).first()).toBeVisible({
        timeout: 15000,
      })
    } finally {
      await ownerContext.close()
      await invitee.context.close()
    }
  })
})
