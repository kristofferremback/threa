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
        data: { role: "user", name: inviteeName },
      })
      expect(joinWorkspaceResponse.ok()).toBeTruthy()

      const usersResponse = await ownerPage.request.get(`/api/workspaces/${workspaceId}/users`)
      expect(usersResponse.ok()).toBeTruthy()
      const usersBody = (await usersResponse.json()) as { users: Array<{ id: string; name: string }> }
      const inviteeUser = usersBody.users.find((user) => user.name === inviteeName)
      expect(inviteeUser).toBeTruthy()

      const draftStreamId = createDmDraftId(inviteeUser!.id)
      await ownerPage.goto(`/w/${workspaceId}/s/${draftStreamId}`)

      const firstMessage = `First DM message ${testId}`
      await ownerPage.locator("[contenteditable='true']").click()
      await ownerPage.keyboard.type(firstMessage)
      await ownerPage.getByRole("button", { name: "Send" }).click()

      await expect(ownerPage).toHaveURL(new RegExp(`/w/${workspaceId}/s/stream_`), { timeout: 10000 })
      await expect(ownerPage.getByRole("main").locator(".message-item").getByText(firstMessage).first()).toBeVisible({
        timeout: 5000,
      })

      const streamId = ownerPage.url().match(/\/s\/([^/?]+)/)?.[1]
      expect(streamId).toBeTruthy()
      expect(streamId).not.toBe(draftStreamId)

      await expect(ownerPage.locator(`a[href="/w/${workspaceId}/s/${draftStreamId}"]`)).toHaveCount(0, {
        timeout: 5000,
      })
      await expect(ownerPage.locator(`a[href="/w/${workspaceId}/s/${streamId}"]`).first()).toBeVisible({
        timeout: 10000,
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

  test("should promote a viewed draft DM for the recipient and resolve activity without refresh", async ({
    browser,
  }) => {
    test.setTimeout(90000)

    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const inviteeEmail = `dm-invitee-${testId}@example.com`

    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    const invitee = await loginInNewContext(browser, inviteeEmail, inviteeEmail)

    try {
      const owner = await loginAndCreateWorkspace(ownerPage, "dm-receiver-promotion")
      const workspaceId = ownerPage.url().match(/\/w\/([^/]+)/)?.[1]
      expect(workspaceId).toBeTruthy()

      const joinWorkspaceResponse = await invitee.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
        data: { role: "user", name: inviteeEmail },
      })
      expect(joinWorkspaceResponse.ok()).toBeTruthy()

      const usersResponse = await ownerPage.request.get(`/api/workspaces/${workspaceId}/users`)
      expect(usersResponse.ok()).toBeTruthy()
      const usersBody = (await usersResponse.json()) as { users: Array<{ id: string; name: string }> }
      const ownerUser = usersBody.users.find((user) => user.name === owner.name)
      const inviteeUser = usersBody.users.find((user) => user.name === inviteeEmail)
      expect(ownerUser).toBeTruthy()
      expect(inviteeUser).toBeTruthy()

      const ownerDraftStreamId = createDmDraftId(inviteeUser!.id)
      await ownerPage.goto(`/w/${workspaceId}/s/${ownerDraftStreamId}`)
      await expect(ownerPage.getByText("Start a conversation")).toBeVisible({ timeout: 5000 })

      const inviteeDraftStreamId = createDmDraftId(ownerUser!.id)
      await invitee.page.goto(`/w/${workspaceId}/s/${inviteeDraftStreamId}`)
      await expect(invitee.page.getByText("Start a conversation")).toBeVisible({ timeout: 5000 })

      const firstMessage = `Incoming first DM ${testId}`
      await invitee.page.locator("[contenteditable='true']").click()
      await invitee.page.keyboard.type(firstMessage)
      await invitee.page.getByRole("button", { name: "Send" }).click()

      await expect(invitee.page).toHaveURL(new RegExp(`/w/${workspaceId}/s/stream_`), { timeout: 15000 })
      const realStreamId = invitee.page.url().match(/\/s\/([^/?]+)/)?.[1]
      expect(realStreamId).toBeTruthy()

      await expect(ownerPage).toHaveURL(new RegExp(`/w/${workspaceId}/s/${realStreamId}`), { timeout: 15000 })
      await expect(ownerPage.getByRole("main").locator(".message-item").getByText(firstMessage).first()).toBeVisible({
        timeout: 10000,
      })
      await expect(ownerPage.locator(`a[href="/w/${workspaceId}/s/${ownerDraftStreamId}"]`)).toHaveCount(0, {
        timeout: 10000,
      })

      await ownerPage.goto(`/w/${workspaceId}/activity`)
      const activityMain = ownerPage.locator("main.py-2")
      await expect
        .poll(async () => ((await activityMain.textContent()) ?? "").replace(/\s+/g, "").trim(), { timeout: 20000 })
        .toContain(`postedin${inviteeEmail}`)
    } finally {
      await ownerContext.close()
      await invitee.context.close()
    }
  })
})
