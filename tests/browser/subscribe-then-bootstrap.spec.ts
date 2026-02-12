import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test"
import { loginAndCreateWorkspace, loginInNewContext } from "./helpers"

test.describe("Subscribe Then Bootstrap", () => {
  test("should request workspace and stream bootstrap during normal navigation", async ({ page }) => {
    const bootstrapRequests: Request[] = []
    page.on("request", (request) => {
      if (request.url().includes("/bootstrap")) {
        bootstrapRequests.push(request)
      }
    })

    const { testId } = await loginAndCreateWorkspace(page, "bootstrap")

    const workspaceMatch = page.url().match(/\/w\/([^/]+)/)
    expect(workspaceMatch).toBeTruthy()
    const workspaceId = workspaceMatch![1]

    await expect
      .poll(
        () =>
          bootstrapRequests.filter((request) => request.url().includes(`/api/workspaces/${workspaceId}/bootstrap`))
            .length,
        {
          timeout: 10000,
          message: "workspace bootstrap request should be made",
        }
      )
      .toBeGreaterThan(0)

    const channelName = `bootstrap-e2e-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 10000 })

    const streamMatch = page.url().match(/\/s\/([^/?]+)/)
    expect(streamMatch).toBeTruthy()
    const streamId = streamMatch![1]

    await expect
      .poll(
        () =>
          bootstrapRequests.filter((request) =>
            request.url().includes(`/api/workspaces/${workspaceId}/streams/${streamId}/bootstrap`)
          ).length,
        {
          timeout: 10000,
          message: "stream bootstrap request should be made",
        }
      )
      .toBeGreaterThan(0)
  })

  test("should bootstrap public stream for workspace member who is not stream member", async ({ browser }) => {
    const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
    const owner = await loginInNewContext(browser, `owner-${testId}@example.com`, `Owner ${testId}`)

    let memberContext: { context: BrowserContext; page: Page } | undefined

    try {
      const workspaceSlug = `subscribe-bootstrap-${testId}`
      const createWorkspaceResponse = await owner.page.request.post("/api/workspaces", {
        data: {
          name: `Subscribe Bootstrap ${testId}`,
          slug: workspaceSlug,
        },
      })
      expect(createWorkspaceResponse.ok()).toBeTruthy()
      const workspaceBody = (await createWorkspaceResponse.json()) as { workspace: { id: string } }
      const workspaceId = workspaceBody.workspace.id

      const publicChannelSlug = `public-${testId}`
      const createStreamResponse = await owner.page.request.post(`/api/workspaces/${workspaceId}/streams`, {
        data: {
          type: "channel",
          slug: publicChannelSlug,
          visibility: "public",
        },
      })
      expect(createStreamResponse.ok()).toBeTruthy()
      const streamBody = (await createStreamResponse.json()) as { stream: { id: string } }
      const streamId = streamBody.stream.id

      memberContext = await loginInNewContext(browser, `member-${testId}@example.com`, `Member ${testId}`)

      const joinWorkspaceResponse = await memberContext.page.request.post(`/api/dev/workspaces/${workspaceId}/join`, {
        data: { role: "member" },
      })
      expect(joinWorkspaceResponse.ok()).toBeTruthy()

      const streamBootstrapResponses: number[] = []
      memberContext.page.on("response", (response) => {
        if (response.url().includes(`/api/workspaces/${workspaceId}/streams/${streamId}/bootstrap`)) {
          streamBootstrapResponses.push(response.status())
        }
      })

      const socketJoinErrors: string[] = []
      memberContext.page.on("console", (message) => {
        const text = message.text()
        if (text.includes("Not authorized to join this stream")) {
          socketJoinErrors.push(text)
        }
      })

      await memberContext.page.goto(`/w/${workspaceId}/s/${streamId}`)
      await expect(memberContext.page.getByRole("heading", { name: `#${publicChannelSlug}`, level: 1 })).toBeVisible({
        timeout: 10000,
      })

      await expect
        .poll(() => streamBootstrapResponses.length, {
          timeout: 10000,
          message: "stream bootstrap should be requested",
        })
        .toBeGreaterThan(0)

      expect(streamBootstrapResponses.some((status) => status >= 200 && status < 300)).toBeTruthy()
      expect(socketJoinErrors).toEqual([])
    } finally {
      await owner.context.close()
      if (memberContext) {
        await memberContext.context.close()
      }
    }
  })
})
