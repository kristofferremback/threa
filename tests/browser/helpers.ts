import { expect, type Page, type Browser, type BrowserContext } from "@playwright/test"

/**
 * Shared helpers for browser E2E tests.
 *
 * Every test creates a unique user + workspace for full isolation,
 * enabling parallel execution across workers without DB conflicts.
 */

/**
 * Generate a unique test ID combining timestamp and random suffix.
 * Safe for parallel workers that might load at the same millisecond.
 */
export function generateTestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

/**
 * Login as a new unique user and create a workspace.
 * This is the standard setup for most browser tests — each test gets
 * a fresh user + workspace so tests can run in parallel safely.
 */
export async function loginAndCreateWorkspace(
  page: Page,
  prefix: string
): Promise<{ testId: string; email: string; name: string; workspaceName: string }> {
  const testId = generateTestId()
  const email = `${prefix}-${testId}@example.com`
  const name = `${prefix} ${testId}`
  const workspaceName = `${prefix} WS ${testId}`

  await page.goto("/login")
  await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Name").fill(name)
  await page.getByRole("button", { name: "Sign In" }).click()
  await expect(page.getByText(/Welcome/)).toBeVisible()

  await page.getByPlaceholder("New workspace name").fill(workspaceName)
  await page.getByRole("button", { name: "Create Workspace" }).click()
  await expect(page.getByRole("button", { name: "+ New Scratchpad" })).toBeVisible({ timeout: 10000 })

  return { testId, email, name, workspaceName }
}

/**
 * Login as a new user in a separate browser context.
 * Useful for multi-user tests (e.g., invitation flows, cross-user messaging).
 */
export async function loginInNewContext(
  browser: Browser,
  email: string,
  name: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto("/login")
  await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Name").fill(name)
  await page.getByRole("button", { name: "Sign In" }).click()
  await expect(page.getByText(/Welcome|Select a stream/)).toBeVisible()

  return { context, page }
}

/**
 * Switch sidebar to "All" view mode (shows Channels/Scratchpads/DMs sections).
 * No-op if already in All view or if empty state (no view toggle).
 */
export async function switchToAllView(page: Page): Promise<void> {
  const allButton = page.getByRole("button", { name: "All" })
  await allButton.waitFor({ state: "visible", timeout: 3000 }).catch(() => {})
  if (await allButton.isVisible()) {
    await allButton.click()
    await expect(page.getByRole("heading", { name: "Channels", level: 3 })).toBeVisible({ timeout: 5000 })
  }
}

/**
 * Create a channel via the dialog prompt and wait for it to load.
 * Switches to "All" view after creation so the channel appears in sidebar.
 */
/**
 * Mirrors the frontend's createDmDraftId so E2E tests reference the same route shape
 * without duplicating the raw string literal at call sites.
 */
export function createDmDraftId(memberId: string): string {
  return `draft_dm_${memberId}`
}

export async function createChannel(page: Page, channelName: string): Promise<void> {
  page.once("dialog", async (dialog) => {
    await dialog.accept(channelName)
  })
  await page.getByRole("button", { name: "+ New Channel" }).click()
  await expect(page.getByRole("heading", { name: `#${channelName}`, level: 1 })).toBeVisible({ timeout: 5000 })
  await switchToAllView(page)
  await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })
}
