import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD } from "@threa/types"
import { db } from "@/db"
import CodeBlock from "./code-block"
import { MarkdownBlockProvider, hashMarkdownBlock, composeBlockCollapseKey } from "./markdown-block-context"
import * as preferencesModule from "@/contexts/preferences-context"

// Stubbable preferences mock: each test can override via `currentPrefs`.
let currentPrefs: { codeBlockCollapseThreshold?: number } | null = {
  codeBlockCollapseThreshold: DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD,
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

function renderCodeBlock(code: string, messageId = "msg_test", language = "typescript") {
  return render(
    <MarkdownBlockProvider messageId={messageId}>
      <CodeBlock language={language}>{code}</CodeBlock>
    </MarkdownBlockProvider>
  )
}

describe("CodeBlock collapse behavior", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.spyOn(preferencesModule, "usePreferences").mockImplementation(() => {
      const value = buildPreferencesContext()
      if (!value) throw new Error("no preferences")
      return value
    })
    vi.spyOn(preferencesModule, "usePreferencesOptional").mockImplementation(() => buildPreferencesContext())

    currentPrefs = { codeBlockCollapseThreshold: DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD }
    await db.markdownBlockCollapse.clear()
  })

  afterEach(async () => {
    await db.markdownBlockCollapse.clear()
  })

  it("renders short code blocks (≤ threshold) expanded by default", async () => {
    const code = "const x = 1\nconst y = 2"
    renderCodeBlock(code)

    // Highlighted HTML eventually appears (expanded state invokes shiki).
    await waitFor(() => {
      expect(document.querySelector("pre.shiki")).toBeInTheDocument()
    })
    // No "click to expand" affordance shown.
    expect(screen.queryByText(/click to expand/i)).not.toBeInTheDocument()
  })

  it("renders long code blocks (> threshold) collapsed by default with a 3-line preview and total line count", async () => {
    const code = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n")
    renderCodeBlock(code)

    // Header advertises the total count + expand affordance.
    expect(screen.getByText(/25 lines, click to expand/i)).toBeInTheDocument()

    // Preview shows the first 3 lines — not the full block.
    const highlighted = await waitFor(() => {
      const el = document.querySelector("pre.shiki")
      expect(el).toBeInTheDocument()
      return el!
    })
    expect(highlighted.textContent).toContain("line 1")
    expect(highlighted.textContent).toContain("line 2")
    expect(highlighted.textContent).toContain("line 3")
    expect(highlighted.textContent).not.toContain("line 4")
    expect(highlighted.textContent).not.toContain("line 25")
  })

  it("expanding a collapsed block reveals the full content", async () => {
    const user = userEvent.setup()
    const code = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n")
    currentPrefs = { codeBlockCollapseThreshold: 3 }
    renderCodeBlock(code, "msg_expand_full")

    // Initially collapsed with preview.
    await waitFor(() => {
      const el = document.querySelector("pre.shiki")
      expect(el?.textContent).not.toContain("line 8")
    })

    await user.click(screen.getByRole("button", { name: /expand 8 lines/i }))

    await waitFor(() => {
      const el = document.querySelector("pre.shiki")
      expect(el?.textContent).toContain("line 8")
    })
  })

  it("uses the user's threshold override when one is set", () => {
    currentPrefs = { codeBlockCollapseThreshold: 3 }
    const code = "line 1\nline 2\nline 3\nline 4\nline 5"
    renderCodeBlock(code)

    // 5 lines > threshold 3 → collapsed by default
    expect(screen.getByText(/5 lines, click to expand/i)).toBeInTheDocument()
  })

  it("treats a threshold of 0 as 'collapse all non-empty blocks'", () => {
    currentPrefs = { codeBlockCollapseThreshold: 0 }
    renderCodeBlock("const x = 1")

    expect(screen.getByText(/1 line, click to expand/i)).toBeInTheDocument()
  })

  it("toggles collapsed → expanded on click and persists the choice to IDB", async () => {
    const user = userEvent.setup()
    const code = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")
    const messageId = "msg_toggle_expand"
    renderCodeBlock(code, messageId)

    const toggle = screen.getByRole("button", { name: /expand 20 lines/i })
    await user.click(toggle)

    await waitFor(() => {
      expect(document.querySelector("pre.shiki")).toBeInTheDocument()
    })

    // Persisted row reflects the expanded override.
    const key = composeBlockCollapseKey(messageId, "code", hashMarkdownBlock(code.trim(), "typescript"))
    const row = await db.markdownBlockCollapse.get(key)
    expect(row?.collapsed).toBe(false)
    expect(row?.kind).toBe("code")
  })

  it("toggles expanded → collapsed on click and persists the choice", async () => {
    const user = userEvent.setup()
    const code = "const a = 1\nconst b = 2"
    const messageId = "msg_toggle_collapse"
    renderCodeBlock(code, messageId)

    await waitFor(() => {
      expect(document.querySelector("pre.shiki")).toBeInTheDocument()
    })

    const toggle = screen.getByRole("button", { name: /collapse code block/i })
    await user.click(toggle)

    await waitFor(() => {
      expect(screen.getByText(/2 lines, click to expand/i)).toBeInTheDocument()
    })

    const key = composeBlockCollapseKey(messageId, "code", hashMarkdownBlock(code.trim(), "typescript"))
    const row = await db.markdownBlockCollapse.get(key)
    expect(row?.collapsed).toBe(true)
  })

  it("restores collapsed state from IDB on subsequent renders", async () => {
    const code = "short block\ntwo lines"
    const messageId = "msg_persisted"
    const key = composeBlockCollapseKey(messageId, "code", hashMarkdownBlock(code.trim(), "typescript"))

    // Pre-seed IDB with a user override (collapsed even though it's short).
    await act(async () => {
      await db.markdownBlockCollapse.put({
        id: key,
        messageId,
        kind: "code",
        collapsed: true,
        updatedAt: Date.now(),
      })
    })

    renderCodeBlock(code, messageId)

    await waitFor(() => {
      expect(screen.getByText(/2 lines, click to expand/i)).toBeInTheDocument()
    })
  })

  it('marks the wrapper with data-native-context="true" so mobile long-press defers to native text selection', () => {
    renderCodeBlock("const x = 1\nconst y = 2")
    expect(document.querySelector('[data-native-context="true"]')).toBeInTheDocument()
  })

  it("scopes collapse state per messageId", async () => {
    const user = userEvent.setup()
    const code = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n")

    const { unmount } = renderCodeBlock(code, "msg_A")
    const toggleA = screen.getByRole("button", { name: /expand 15 lines/i })
    await user.click(toggleA)
    await waitFor(() => expect(document.querySelector("pre.shiki")).toBeInTheDocument())
    unmount()

    // Second message with the exact same content should not inherit the expand.
    renderCodeBlock(code, "msg_B")
    expect(screen.getByText(/15 lines, click to expand/i)).toBeInTheDocument()
  })
})
