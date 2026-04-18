import { test, expect, type Page } from "@playwright/test"
import { expectApiOk, loginAndCreateWorkspace } from "./helpers"

/**
 * End-to-end: saving a message with a past `remindAt` (server clamps to NOW)
 * should fire through the queue worker and materialise a `saved_reminder`
 * activity row. The full stack is exercised: save handler → outbox →
 * reminder worker → activity outbox handler → activity:created event → feed.
 */

async function pollForSavedReminderActivity(page: Page, workspaceId: string, messageId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/workspaces/${workspaceId}/activity?limit=50`)
        if (!res.ok()) return "fetch-failed"
        const body = (await res.json()) as {
          activities: Array<{ activityType: string; messageId: string }>
        }
        const match = body.activities.find((a) => a.activityType === "saved_reminder" && a.messageId === messageId)
        return match ? "found" : "pending"
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] }
    )
    .toBe("found")
}

test.describe("Saved reminder", () => {
  test("past reminder fires through the queue and lands in the activity feed", async ({ page }) => {
    test.setTimeout(60_000)
    const { testId } = await loginAndCreateWorkspace(page, "saved")

    // loginAndCreateWorkspace navigates to /w/:workspaceId; read the id from
    // the URL instead of threading it through the helper's return shape.
    const url = new URL(page.url())
    const workspaceId = url.pathname.split("/")[2]
    expect(workspaceId).toMatch(/^ws_/)

    // Use a channel instead of the auto-provisioned scratchpad — channels
    // expose a stable slug we can assert on in the activity row.
    const channelSlug = `saved-${testId}`
    const createStreamRes = await page.request.post(`/api/workspaces/${workspaceId}/streams`, {
      data: { type: "channel", slug: channelSlug, visibility: "public" },
    })
    await expectApiOk(createStreamRes, "Channel creation")
    const { stream } = (await createStreamRes.json()) as { stream: { id: string } }
    const streamId = stream.id

    const messageText = `Remind me about this ${testId}`
    const sendMsgRes = await page.request.post(`/api/workspaces/${workspaceId}/messages`, {
      data: { streamId, content: messageText },
    })
    await expectApiOk(sendMsgRes, "Message create")
    const { message } = (await sendMsgRes.json()) as { message: { id: string } }
    const messageId = message.id

    // Save with remindAt in the past — the service clamps to NOW and enqueues
    // a job with process_after = now, which the worker picks up on its next
    // poll tick (well under the 30s poll timeout below).
    const pastInstant = new Date(Date.now() - 60_000).toISOString()
    const saveRes = await page.request.post(`/api/workspaces/${workspaceId}/saved`, {
      data: { messageId, remindAt: pastInstant },
    })
    await expectApiOk(saveRes, "Save message with past reminder")

    await pollForSavedReminderActivity(page, workspaceId, messageId)

    // Also verify the UI renders it — exercises the saved_reminder row path in
    // activity-content.tsx (actor suppressed, Bell avatar, stream name chip).
    await page.goto(`/w/${workspaceId}/activity`)
    const main = page.getByRole("main")
    await expect(main.getByText(/Reminder for message in/)).toBeVisible({ timeout: 15_000 })
    await expect(main.getByText(new RegExp(`#${channelSlug}`))).toBeVisible()
  })
})
