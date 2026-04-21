import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD } from "@threa/types"
import { db } from "@/db"
import { BlockquoteBlock } from "./blockquote-block"
import { MarkdownBlockProvider, composeBlockCollapseKey, hashMarkdownBlock } from "./markdown-block-context"
import * as preferencesModule from "@/contexts/preferences-context"

// Stubbable preferences mock — each test can override via `currentPrefs`.
let currentPrefs: { blockquoteCollapseThreshold?: number } | null = {
  blockquoteCollapseThreshold: DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD,
}

function buildPreferencesContext() {
  if (!currentPrefs) return null
  return {
    preferences: currentPrefs,
    resolvedTheme: "light",
    isLoading: false,
    updatePreference: vi.fn(),
    updateAccessibility: vi.fn(),
    updateKeyboardShortcut: vi.fn(),
    resetKeyboardShortcut: vi.fn(),
    resetAllKeyboardShortcuts: vi.fn(),
  } as unknown as ReturnType<typeof preferencesModule.usePreferences>
}

function renderBlockquote(children: React.ReactNode, messageId = "msg_quote") {
  return render(
    <MarkdownBlockProvider messageId={messageId}>
      <BlockquoteBlock>{children}</BlockquoteBlock>
    </MarkdownBlockProvider>
  )
}

describe("BlockquoteBlock collapse behavior", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.spyOn(preferencesModule, "usePreferences").mockImplementation(() => {
      const value = buildPreferencesContext()
      if (!value) throw new Error("no preferences")
      return value
    })
    vi.spyOn(preferencesModule, "usePreferencesOptional").mockImplementation(() => buildPreferencesContext())
    currentPrefs = { blockquoteCollapseThreshold: DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD }
    await db.markdownBlockCollapse.clear()
  })

  afterEach(async () => {
    await db.markdownBlockCollapse.clear()
  })

  it("renders short quotes expanded by default", () => {
    renderBlockquote(<p>A short quote.</p>)
    expect(screen.getByText("A short quote.")).toBeInTheDocument()
    expect(screen.queryByText(/click to expand/i)).not.toBeInTheDocument()
  })

  it("collapses long quotes by default and shows a line-count affordance", () => {
    currentPrefs = { blockquoteCollapseThreshold: 2 }
    renderBlockquote(
      <>
        <p>Paragraph one of the quote.</p>
        <p>Paragraph two continues the thought.</p>
        <p>Paragraph three ties it together.</p>
      </>
    )
    expect(screen.getByText(/3 lines, click to expand/i)).toBeInTheDocument()
  })

  it("a short block quote also honors an explicit low threshold", () => {
    currentPrefs = { blockquoteCollapseThreshold: 0 }
    renderBlockquote(<p>Just one line.</p>)
    expect(screen.getByText(/1 line, click to expand/i)).toBeInTheDocument()
  })

  it("expanding a collapsed quote reveals the full content", async () => {
    const user = userEvent.setup()
    currentPrefs = { blockquoteCollapseThreshold: 1 }
    renderBlockquote(
      <>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
        <p>Third paragraph revealed only after expanding.</p>
      </>
    )

    // Initially collapsed — third paragraph is not in the DOM.
    expect(screen.queryByText("Third paragraph revealed only after expanding.")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /expand 3 lines/i }))

    await waitFor(() => {
      expect(screen.getByText("Third paragraph revealed only after expanding.")).toBeInTheDocument()
    })
  })

  it("persists a user's toggle choice keyed by message + kind + content hash", async () => {
    const user = userEvent.setup()
    currentPrefs = { blockquoteCollapseThreshold: 1 }
    const messageId = "msg_persist_quote"
    renderBlockquote(
      <>
        <p>A quote that is long enough to be collapsed.</p>
        <p>With a second line for good measure.</p>
      </>,
      messageId
    )

    await user.click(screen.getByRole("button", { name: /expand/i }))

    await waitFor(async () => {
      const rows = await db.markdownBlockCollapse.where("messageId").equals(messageId).toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe("blockquote")
      expect(rows[0].collapsed).toBe(false)
    })
  })

  it("restores collapsed state from IDB on subsequent renders", async () => {
    const messageId = "msg_restore_quote"
    const text = "Preserved quote."
    const hash = hashMarkdownBlock(text, "blockquote")
    const key = composeBlockCollapseKey(messageId, "blockquote", hash)

    await act(async () => {
      await db.markdownBlockCollapse.put({
        id: key,
        messageId,
        kind: "blockquote",
        collapsed: true,
        updatedAt: Date.now(),
      })
    })

    renderBlockquote(<p>{text}</p>, messageId)

    await waitFor(() => {
      expect(screen.getByText(/click to expand/i)).toBeInTheDocument()
    })
  })

  it("scopes collapse state per messageId", async () => {
    const user = userEvent.setup()
    currentPrefs = { blockquoteCollapseThreshold: 1 }
    const body = (
      <>
        <p>Shared quote content A.</p>
        <p>Shared quote content B.</p>
      </>
    )

    const { unmount } = renderBlockquote(body, "msg_quote_A")
    await user.click(screen.getByRole("button", { name: /expand/i }))
    unmount()

    // Second message with the same content should still collapse by default.
    renderBlockquote(body, "msg_quote_B")
    expect(screen.getByText(/click to expand/i)).toBeInTheDocument()
  })

  it("does not collide with code-block collapse entries for the same text", async () => {
    const user = userEvent.setup()
    currentPrefs = { blockquoteCollapseThreshold: 1 }
    const messageId = "msg_mixed"

    renderBlockquote(
      <>
        <p>const x = 1</p>
        <p>const y = 2</p>
      </>,
      messageId
    )

    await user.click(screen.getByRole("button", { name: /expand/i }))

    const rows = await db.markdownBlockCollapse.where("messageId").equals(messageId).toArray()
    expect(rows.every((row) => row.kind === "blockquote")).toBe(true)
  })
})
