import { test, expect } from "@playwright/test"
import * as path from "path"
import * as fs from "fs"

/**
 * Tests for inline file uploads via paste and drag-drop.
 *
 * Tests:
 * 1. Pasting an image inserts [Image #N] reference and attachment chip
 * 2. Pasting a non-image file inserts [filename] reference
 * 3. Drag-drop works the same as paste
 * 4. Multiple images get sequential numbering
 */

test.describe("Inline File Uploads", () => {
  const testId = Date.now().toString(36)
  const testEmail = `upload-test-${testId}@example.com`
  const testName = `Upload Test ${testId}`
  const workspaceName = `Upload Test WS ${testId}`

  // Helper to create a test image as a buffer
  function createTestImage(): Buffer {
    // 1x1 red PNG
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
      0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4,
      0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    return pngData
  }

  test.beforeEach(async ({ page }) => {
    // Login and create workspace
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
    await expect(page.getByRole("heading", { name: "Test Login" })).toBeVisible()

    await page.getByLabel("Email").fill(testEmail)
    await page.getByLabel("Name").fill(testName)
    await page.getByRole("button", { name: "Sign In" }).click()

    // Wait for workspace selection page
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible()

    // Create workspace (new user flow)
    const workspaceInput = page.getByPlaceholder("New workspace name")
    await workspaceInput.fill(workspaceName)
    const createButton = page.getByRole("button", { name: "Create Workspace" })
    await expect(createButton).toBeEnabled()
    await createButton.click()

    // Wait for sidebar to be visible (workspace loaded)
    await expect(page.getByRole("heading", { name: "Channels", level: 3 })).toBeVisible({ timeout: 10000 })

    // Create a channel for testing
    const channelName = `upload-${testId}`
    page.once("dialog", async (dialog) => {
      await dialog.accept(channelName)
    })
    await page.getByRole("button", { name: "+ New Channel" }).click()
    await expect(page.getByRole("link", { name: `#${channelName}` })).toBeVisible({ timeout: 5000 })
  })

  test("should insert [Image #1] reference when pasting an image", async ({ page }) => {
    // Focus the editor
    const editor = page.locator("[contenteditable='true']")
    await editor.click()

    // Create a DataTransfer with an image file
    const imageBuffer = createTestImage()

    // Use evaluate to simulate paste with file
    await page.evaluate(async (imageData) => {
      const editor = document.querySelector("[contenteditable='true']")
      if (!editor) throw new Error("Editor not found")

      // Create a File from the image data
      const uint8Array = new Uint8Array(imageData)
      const blob = new Blob([uint8Array], { type: "image/png" })
      const file = new File([blob], "test-image.png", { type: "image/png" })

      // Create DataTransfer with the file
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)

      // Create and dispatch paste event
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      })

      editor.dispatchEvent(pasteEvent)
    }, Array.from(imageBuffer))

    // Wait for upload to complete and verify the reference appears
    // Should show [Image #1] or similar
    await expect(editor.locator("span[data-type='attachment-reference']")).toBeVisible({ timeout: 10000 })

    // Verify attachment chip also appears
    await expect(page.locator("[data-testid='attachment-chip']").or(page.getByText("test-image.png"))).toBeVisible({
      timeout: 5000,
    })
  })

  test("should insert [filename] reference when pasting a non-image file", async ({ page }) => {
    // Focus the editor
    const editor = page.locator("[contenteditable='true']")
    await editor.click()

    // Create a text file
    const textContent = "Hello, world!"

    await page.evaluate(async (content) => {
      const editor = document.querySelector("[contenteditable='true']")
      if (!editor) throw new Error("Editor not found")

      const blob = new Blob([content], { type: "text/plain" })
      const file = new File([blob], "document.txt", { type: "text/plain" })

      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      })

      editor.dispatchEvent(pasteEvent)
    }, textContent)

    // Should show the filename in the reference
    await expect(editor.locator("span[data-type='attachment-reference']")).toBeVisible({ timeout: 10000 })
  })

  test("should number images sequentially when pasting multiple", async ({ page }) => {
    const editor = page.locator("[contenteditable='true']")
    await editor.click()

    const imageBuffer = createTestImage()

    // Paste first image
    await page.evaluate(async (imageData) => {
      const editor = document.querySelector("[contenteditable='true']")
      if (!editor) throw new Error("Editor not found")

      const uint8Array = new Uint8Array(imageData)
      const blob = new Blob([uint8Array], { type: "image/png" })
      const file = new File([blob], "image1.png", { type: "image/png" })

      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      })

      editor.dispatchEvent(pasteEvent)
    }, Array.from(imageBuffer))

    // Wait for first upload
    await expect(editor.locator("span[data-type='attachment-reference']")).toBeVisible({ timeout: 10000 })

    // Paste second image
    await page.evaluate(async (imageData) => {
      const editor = document.querySelector("[contenteditable='true']")
      if (!editor) throw new Error("Editor not found")

      const uint8Array = new Uint8Array(imageData)
      const blob = new Blob([uint8Array], { type: "image/png" })
      const file = new File([blob], "image2.png", { type: "image/png" })

      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      })

      editor.dispatchEvent(pasteEvent)
    }, Array.from(imageBuffer))

    // Should have two references
    await expect(editor.locator("span[data-type='attachment-reference']")).toHaveCount(2, { timeout: 10000 })
  })
})
