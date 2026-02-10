import { expect, test, type Request } from "@playwright/test"

test.describe("Subscribe Then Bootstrap", () => {
  const testId = Date.now().toString(36)

  test("should request workspace and stream bootstrap during normal navigation", async ({ page }) => {
    const bootstrapRequests: Request[] = []
    page.on("request", (request) => {
      if (request.url().includes("/bootstrap")) {
        bootstrapRequests.push(request)
      }
    })

    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    const workspaceInput = page.getByPlaceholder("New workspace name")
    if (await workspaceInput.isVisible()) {
      await workspaceInput.fill(`Bootstrap Test ${testId}`)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible({ timeout: 10000 })

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
})
