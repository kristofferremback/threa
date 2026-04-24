import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD } from "@threa/types"
import { db } from "@/db"
import { QuoteReplyBlock } from "./quote-reply-block"
import { BlockquoteBlock } from "./blockquote-block"
import { MarkdownBlockProvider } from "./markdown-block-context"
import * as preferencesModule from "@/contexts/preferences-context"
import * as hooksModule from "@/hooks"
import * as userProfileModule from "@/components/user-profile"

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

function renderInWorkspace(ui: React.ReactElement, workspaceId = "ws_test") {
  return render(
    <MemoryRouter initialEntries={[`/w/${workspaceId}`]}>
      <Routes>
        <Route path="/w/:workspaceId" element={ui} />
      </Routes>
    </MemoryRouter>
  )
}

describe("QuoteReplyBlock nesting behavior", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.spyOn(preferencesModule, "usePreferencesOptional").mockImplementation(() => buildPreferencesContext())
    vi.spyOn(hooksModule, "useActors").mockReturnValue({
      getActorName: () => "Alex",
      getActorInitials: () => "AL",
      getActorAvatar: () => ({ fallback: "AL" }),
      getUser: () => undefined,
      getPersona: () => undefined,
      getBot: () => undefined,
    } as unknown as ReturnType<typeof hooksModule.useActors>)
    vi.spyOn(userProfileModule, "useUserProfile").mockReturnValue({
      openUserProfile: vi.fn(),
    } as unknown as ReturnType<typeof userProfileModule.useUserProfile>)
    currentPrefs = { blockquoteCollapseThreshold: 100 }
    await db.markdownBlockCollapse.clear()
  })

  afterEach(async () => {
    await db.markdownBlockCollapse.clear()
  })

  it("only the outer quote-reply folds when a blockquote is nested inside it", () => {
    renderInWorkspace(
      <MarkdownBlockProvider messageId="msg_nested_qr">
        <QuoteReplyBlock
          authorName="Alex"
          authorId="user_alex"
          actorType="user"
          streamId="stream_src"
          messageId="msg_src"
        >
          <BlockquoteBlock>
            <p>Inner quote line.</p>
          </BlockquoteBlock>
        </QuoteReplyBlock>
      </MarkdownBlockProvider>
    )

    // Quote-reply renders its own toggle (the outermost foldable block).
    expect(screen.getAllByRole("button", { name: /collapse quote reply/i })).toHaveLength(1)
    // The nested blockquote does NOT render a fold toggle of its own.
    expect(screen.queryByRole("button", { name: /collapse block quote/i })).not.toBeInTheDocument()
    expect(screen.getByText("Inner quote line.")).toBeInTheDocument()
  })
})
