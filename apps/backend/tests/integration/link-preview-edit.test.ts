import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { setupTestDatabase } from "./setup"
import { LinkPreviewService, LinkPreviewRepository } from "../../src/features/link-previews"
import { OutboxRepository } from "../../src/lib/outbox"
import { streamId, workspaceId, messageId } from "../../src/lib/id"

describe("Link preview edit flow", () => {
  let pool: Pool
  let service: LinkPreviewService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    service = new LinkPreviewService({ pool })
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM message_link_previews")
    await pool.query("DELETE FROM user_link_preview_dismissals")
    await pool.query("DELETE FROM link_previews")
    await pool.query(
      "DELETE FROM outbox WHERE id > (SELECT COALESCE(MAX(last_processed_id), 0) FROM outbox_listeners WHERE listener_id = 'broadcast')"
    )
  })

  test("replacePreviewsForMessage clears old previews and creates new ones", async () => {
    const wsId = workspaceId()
    const msgId = messageId()

    // Create initial previews (simulates message:created flow)
    const initial = await service.extractAndCreatePending(
      wsId,
      msgId,
      "Check out https://example.com and https://old-site.org"
    )
    expect(initial).toHaveLength(2)

    // Edit: replace with a different URL
    const replaced = await service.replacePreviewsForMessage(wsId, msgId, "Check out https://new-site.com instead")

    expect(replaced).toHaveLength(1)
    expect(replaced[0].url).toBe("https://new-site.com")

    // Verify only the new preview is linked to the message
    const linked = await LinkPreviewRepository.findByMessageId(pool, wsId, msgId)
    expect(linked).toHaveLength(1)
    expect(linked[0].url).toBe("https://new-site.com")
  })

  test("replacePreviewsForMessage with no URLs clears all previews", async () => {
    const wsId = workspaceId()
    const msgId = messageId()

    // Create initial previews
    await service.extractAndCreatePending(wsId, msgId, "Visit https://example.com")

    // Edit: remove all URLs
    const replaced = await service.replacePreviewsForMessage(wsId, msgId, "No links here anymore")

    expect(replaced).toHaveLength(0)

    const linked = await LinkPreviewRepository.findByMessageId(pool, wsId, msgId)
    expect(linked).toHaveLength(0)
  })

  test("replacePreviewsForMessage reuses cached preview for same URL", async () => {
    const wsId = workspaceId()
    const msgId = messageId()

    // Create and "complete" a preview (simulates worker having already fetched it)
    const initial = await service.extractAndCreatePending(wsId, msgId, "Visit https://example.com")
    expect(initial).toHaveLength(1)
    const originalId = initial[0].id

    // Complete the preview metadata (simulates worker updating after fetch)
    await LinkPreviewRepository.updateMetadata(pool, wsId, originalId, {
      title: "Example Site",
      description: "An example",
      status: "completed",
    })

    // Edit: same URL survives (ON CONFLICT returns existing row)
    const replaced = await service.replacePreviewsForMessage(wsId, msgId, "Still visiting https://example.com")

    expect(replaced).toHaveLength(1)
    // Should reuse the same preview record (same normalized URL)
    expect(replaced[0].id).toBe(originalId)

    // Verify it's still completed with metadata
    const linked = await LinkPreviewRepository.findByMessageId(pool, wsId, msgId)
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({
      id: originalId,
      title: "Example Site",
      status: "completed",
    })
  })

  test("publishEmptyPreviews writes a link_preview:ready outbox event with empty array", async () => {
    const wsId = workspaceId()
    const stId = streamId()
    const msgId = messageId()

    await service.publishEmptyPreviews(wsId, stId, msgId)

    // Fetch the latest outbox event
    const result = await pool.query(
      "SELECT * FROM outbox WHERE event_type = 'link_preview:ready' ORDER BY id DESC LIMIT 1"
    )
    expect(result.rows).toHaveLength(1)

    const payload = result.rows[0].payload as { messageId: string; previews: unknown[] }
    expect(payload.messageId).toBe(msgId)
    expect(payload.previews).toEqual([])
  })

  test("completePreviewsAndPublish with forcePublish emits event even when all previews were cached", async () => {
    const wsId = workspaceId()
    const stId = streamId()
    const msgId = messageId()

    // Create and complete a preview
    const pending = await service.extractAndCreatePending(wsId, msgId, "Visit https://example.com")
    await LinkPreviewRepository.updateMetadata(pool, wsId, pending[0].id, {
      title: "Example",
      status: "completed",
    })

    // Simulate edit flow: all previews are "skipped" (already cached), but forcePublish is true
    await service.completePreviewsAndPublish(wsId, stId, msgId, [{ id: pending[0].id, skipped: true }], {
      forcePublish: true,
    })

    const result = await pool.query(
      "SELECT * FROM outbox WHERE event_type = 'link_preview:ready' ORDER BY id DESC LIMIT 1"
    )
    expect(result.rows).toHaveLength(1)

    const payload = result.rows[0].payload as { previews: Array<{ id: string }> }
    expect(payload.previews).toHaveLength(1)
    expect(payload.previews[0].id).toBe(pending[0].id)
  })

  test("completePreviewsAndPublish with forcePublish emits empty previews when all fetches failed", async () => {
    const wsId = workspaceId()
    const stId = streamId()
    const msgId = messageId()

    // Create a pending preview (simulates replacePreviewsForMessage creating a new record)
    const pending = await service.extractAndCreatePending(wsId, msgId, "Visit https://example.com")

    // Simulate edit flow where the fetch failed: metadata sets status to "failed"
    await service.completePreviewsAndPublish(
      wsId,
      stId,
      msgId,
      [{ id: pending[0].id, metadata: { status: "failed" }, skipped: false }],
      { forcePublish: true }
    )

    const result = await pool.query(
      "SELECT * FROM outbox WHERE event_type = 'link_preview:ready' ORDER BY id DESC LIMIT 1"
    )
    expect(result.rows).toHaveLength(1)

    const payload = result.rows[0].payload as { messageId: string; previews: unknown[] }
    expect(payload.messageId).toBe(msgId)
    expect(payload.previews).toEqual([])
  })

  test("completePreviewsAndPublish without forcePublish skips event when all previews were cached", async () => {
    const wsId = workspaceId()
    const stId = streamId()
    const msgId = messageId()

    // Create and complete a preview
    const pending = await service.extractAndCreatePending(wsId, msgId, "Visit https://example.com")
    await LinkPreviewRepository.updateMetadata(pool, wsId, pending[0].id, {
      title: "Example",
      status: "completed",
    })

    // Without forcePublish, skipped-only results should NOT emit an outbox event
    await service.completePreviewsAndPublish(wsId, stId, msgId, [{ id: pending[0].id, skipped: true }])

    const result = await pool.query("SELECT * FROM outbox WHERE event_type = 'link_preview:ready'")
    expect(result.rows).toHaveLength(0)
  })
})
