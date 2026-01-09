import { test, expect, type Request } from "@playwright/test"

/**
 * Tests for 404 stream handling.
 *
 * Verifies that:
 * 1. Navigating to a non-existent stream shows an error page
 * 2. No continuous 404 requests are made (the bug we're fixing)
 */

test.describe("Stream Not Found", () => {
  const testId = Date.now().toString(36)

  test("should show error page for non-existent stream without continuous requests", async ({ page }) => {
    // Track all bootstrap requests
    const bootstrapRequests: Request[] = []
    page.on("request", (request) => {
      if (request.url().includes("/bootstrap")) {
        console.log(`[REQUEST] ${request.url()}`)
        bootstrapRequests.push(request)
      }
    })
    page.on("response", (response) => {
      if (response.url().includes("/bootstrap")) {
        console.log(`[RESPONSE] ${response.status()} ${response.url()}`)
      }
    })

    // Login as Alice
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    // Wait for workspace page
    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    // Create workspace if needed
    const workspaceInput = page.getByPlaceholder("New workspace name")
    if (await workspaceInput.isVisible()) {
      await workspaceInput.fill(`404 Test ${testId}`)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    // Wait for sidebar to be visible (we're in a workspace)
    await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible()

    // Get the current URL to extract workspaceId
    const url = page.url()
    const workspaceIdMatch = url.match(/\/w\/([^/]+)/)
    expect(workspaceIdMatch).toBeTruthy()
    const workspaceId = workspaceIdMatch![1]

    // Clear previous requests before navigating to non-existent stream
    bootstrapRequests.length = 0

    // Navigate to a non-existent stream
    const nonExistentStreamId = "stream_01NONEXISTENT000000000000"
    await page.goto(`/w/${workspaceId}/s/${nonExistentStreamId}`)

    // Wait for the error page to appear
    await expect(page.getByText("The Thread Has Broken")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("The path you seek has faded")).toBeVisible()

    // Wait a bit to see if more requests come in
    await page.waitForTimeout(2000)

    // Count how many bootstrap requests were made for the non-existent stream
    const nonExistentStreamRequests = bootstrapRequests.filter((r) => r.url().includes(nonExistentStreamId))

    // Should only have 1 request (the initial fetch that returned 404)
    // If there are more, we have a continuous request loop bug
    console.log(`Bootstrap requests for non-existent stream: ${nonExistentStreamRequests.length}`)
    expect(nonExistentStreamRequests.length).toBeLessThanOrEqual(2) // Allow 2 for potential StrictMode double-render

    // Verify we can navigate back to a working page (Button asChild wraps a Link, so role is "link")
    await page.getByRole("link", { name: "Return to Workspace" }).click()
    await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible()
  })

  test("should handle 404 in side panel without affecting main stream", async ({ page }) => {
    // Track all bootstrap requests
    const bootstrapRequests: Request[] = []
    page.on("request", (request) => {
      if (request.url().includes("/bootstrap")) {
        bootstrapRequests.push(request)
      }
    })

    // Login as Alice
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await page.getByRole("button", { name: /Alice Anderson/ }).click()

    // Wait for workspace page
    await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

    // Create workspace if needed
    const workspaceInput = page.getByPlaceholder("New workspace name")
    if (await workspaceInput.isVisible()) {
      await workspaceInput.fill(`Panel 404 Test ${testId}`)
      await page.getByRole("button", { name: "Create Workspace" }).click()
    }

    // Wait for sidebar and create a scratchpad
    await expect(page.getByRole("heading", { name: "Scratchpads", level: 3 })).toBeVisible()
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()

    // Wait for scratchpad to load
    await expect(page.getByText("Start a conversation")).toBeVisible({ timeout: 5000 })

    // Get the current URL
    const url = page.url()
    const workspaceIdMatch = url.match(/\/w\/([^/]+)/)
    expect(workspaceIdMatch).toBeTruthy()
    const workspaceId = workspaceIdMatch![1]
    const streamIdMatch = url.match(/\/s\/([^/?]+)/)
    expect(streamIdMatch).toBeTruthy()
    const validStreamId = streamIdMatch![1]

    // Clear previous requests
    bootstrapRequests.length = 0

    // Navigate to current stream with a non-existent panel
    const nonExistentStreamId = "stream_01NONEXISTENT000000000000"
    await page.goto(`/w/${workspaceId}/s/${validStreamId}?panel=${nonExistentStreamId}`)

    // The main stream content should still be visible
    await expect(page.getByText("Start a conversation")).toBeVisible({ timeout: 5000 })

    // The panel should show an error
    await expect(page.getByText("The Thread Has Broken")).toBeVisible({ timeout: 5000 })

    // Wait to check for continuous requests
    await page.waitForTimeout(2000)

    // Count requests for the non-existent stream
    const nonExistentStreamRequests = bootstrapRequests.filter((r) => r.url().includes(nonExistentStreamId))

    console.log(`Panel bootstrap requests for non-existent stream: ${nonExistentStreamRequests.length}`)
    expect(nonExistentStreamRequests.length).toBeLessThanOrEqual(2)
  })
})
