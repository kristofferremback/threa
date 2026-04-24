import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { SharedMessagesProvider } from "@/components/shared-messages/context"
import { db } from "@/db"

function renderMarkdown(content: string, hydrationMap: Parameters<typeof SharedMessagesProvider>[0]["map"] = null) {
  return render(
    <MemoryRouter initialEntries={["/w/ws_1/s/stream_dst"]}>
      <Routes>
        <Route
          path="/w/:workspaceId/s/:streamId"
          element={
            <SharedMessagesProvider map={hydrationMap}>
              <MarkdownContent content={content} />
            </SharedMessagesProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe("MarkdownContent — sharedMessage paragraph swap", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await db.events.clear()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await db.events.clear()
  })

  it("replaces the 'Shared a message from X' paragraph with a pointer card", () => {
    const markdown = "Shared a message from [Ariadne](shared-message:stream_src/msg_abc)"
    renderMarkdown(markdown)

    const card = document.querySelector('[data-type="shared-message"]')
    expect(card).not.toBeNull()
    // The raw "Shared a message from" prose is gone — only the author label remains.
    expect(screen.queryByText(/Shared a message from/)).toBeNull()
    expect(screen.getByText("Ariadne")).toBeInTheDocument()
  })

  it("renders the source message body when the hydration map has an ok entry", () => {
    const markdown = "Shared a message from [Ariadne](shared-message:stream_src/msg_abc)"
    renderMarkdown(markdown, {
      msg_abc: {
        state: "ok",
        messageId: "msg_abc",
        streamId: "stream_src",
        authorId: "usr_1",
        authorName: "Ariadne",
        authorType: "user",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "hi from the source",
        editedAt: null,
        createdAt: "2026-04-23T10:00:00Z",
      },
    })

    expect(screen.getByText("hi from the source")).toBeInTheDocument()
  })

  it("renders the source message body from local IDB when hydration is absent", async () => {
    await db.events.put({
      id: "evt_cached",
      workspaceId: "ws_1",
      streamId: "stream_src",
      sequence: "1",
      _sequenceNum: 1,
      eventType: "message_created",
      payload: { messageId: "msg_abc", contentMarkdown: "local idb snippet" },
      actorId: "usr_42",
      actorType: "user",
      createdAt: "2026-04-23T10:00:00Z",
      _cachedAt: Date.now(),
    })

    const markdown = "Shared a message from [Ariadne](shared-message:stream_src/msg_abc)"
    renderMarkdown(markdown)

    await waitFor(() => {
      expect(screen.getByText("local idb snippet")).toBeInTheDocument()
    })
  })

  it("leaves plain paragraphs without shared-message anchors untouched", () => {
    renderMarkdown("Just a regular paragraph")
    expect(screen.getByText("Just a regular paragraph").tagName).toBe("P")
    expect(document.querySelector('[data-type="shared-message"]')).toBeNull()
  })
})
