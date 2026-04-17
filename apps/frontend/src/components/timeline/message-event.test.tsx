import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ServicesProvider, type SavedService } from "@/contexts"
import { MessageEvent } from "./message-event"
import { EditLastMessageContext } from "./edit-last-message-context"
import * as editorModule from "@/components/editor"
import * as hooksModule from "@/hooks"
import * as prosemirrorModule from "@threa/prosemirror"
import userEvent from "@testing-library/user-event"
import type { StreamEvent } from "@threa/types"
import type { JSONContent } from "@threa/types"

// Configurable mock state for usePendingMessages — tests can override per-describe
let mockGetStatus: (id: string) => string | null = () => null
const mockRetryMessage = vi.fn()
const mockMarkEditing = vi.fn()
const mockDeleteMessage = vi.fn()
const mockSaveEditedMessage = vi.fn()
const mockCancelEditing = vi.fn()

// RichEditor is a forwardRef object — vi.spyOn can't spy on non-function values,
// so we replace it at the module level with a vi.fn() that tests can configure.
vi.mock("@/components/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor")>()
  return {
    ...actual,
    RichEditor: vi.fn().mockReturnValue(null),
    DocumentEditorModal: vi.fn().mockReturnValue(null),
  }
})

// Only mock what can't run in jsdom: routing and data-fetching hooks
vi.mock("react-router-dom", () => ({
  Link: ({
    to,
    children,
    className,
    onClick,
  }: {
    to: string
    children: React.ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}))

vi.mock("@/sync/sync-engine", () => ({
  useSyncEngine: () => ({ kickOperationQueue: vi.fn() }),
}))

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    usePendingMessages: () => ({
      getStatus: (id: string) => mockGetStatus(id),
      markPending: vi.fn(),
      markFailed: vi.fn(),
      markSent: vi.fn(),
      markEditing: mockMarkEditing,
      saveEditedMessage: mockSaveEditedMessage,
      cancelEditing: mockCancelEditing,
      retryMessage: mockRetryMessage,
      deleteMessage: mockDeleteMessage,
      notifyQueue: vi.fn(),
      registerQueueNotify: vi.fn(),
    }),
    usePanel: () => ({
      panelId: null,
      getPanelUrl: (streamId: string) => `/panel/${streamId}`,
    }),
    useTrace: () => ({
      getTraceUrl: (sessionId: string) => `/trace/${sessionId}`,
    }),
    useMediaGallery: () => ({
      mediaAttachmentId: null,
      openMedia: vi.fn(),
      closeMedia: vi.fn(),
    }),
    usePreferences: () => ({
      preferences: { timezone: "UTC", locale: "en-US" },
    }),
    useMessageService: () => ({
      delete: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({}),
      getVersions: vi.fn().mockResolvedValue([]),
    }),
  }
})

// MessageEvent calls useSaveMessage/useDeleteSaved which reach the
// SavedService context. We satisfy them by providing a no-op SavedService
// through the real ServicesProvider in the test Wrapper below — no mocking
// of the saved hooks themselves (INV-48).

vi.mock("@/auth", () => ({
  useUser: () => ({ id: "workos_user_123" }),
}))

vi.mock("@/components/user-profile", () => ({
  useUserProfile: () => ({ openUserProfile: vi.fn() }),
}))

vi.mock("@/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks")>()
  return {
    ...actual,
    useActors: () => ({
      getActorName: (_actorId: string | null, actorType: string | null) => {
        if (actorType === "persona") return "Ariadne"
        return "Test User"
      },
      getActorAvatar: (_actorId: string | null, actorType: string | null) => {
        if (actorType === "persona") return { fallback: "🜃", slug: "ariadne" }
        return { fallback: "TU", slug: undefined }
      },
    }),
    useWorkspaceBootstrap: () => ({
      data: { users: [{ id: "member_123", workosUserId: "workos_user_123" }] },
    }),
    useWorkspaceUserId: () => "member_123",
    focusAtEnd: vi.fn(),
  }
})

const createMessageEvent = (messageId: string, contentMarkdown: string): StreamEvent => ({
  id: `event_${messageId}`,
  streamId: "stream_123",
  sequence: "1",
  eventType: "message_created",
  actorType: "user",
  actorId: "member_123",
  createdAt: new Date().toISOString(),
  payload: { messageId, contentMarkdown },
})

let queryClient: QueryClient
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockGetStatus = () => null // default: sent/confirmed message
  mockRetryMessage.mockReset()
  mockMarkEditing.mockReset()
  mockDeleteMessage.mockReset()
  mockSaveEditedMessage.mockReset()
  mockCancelEditing.mockReset()
})

// Minimal SavedService shim — the tests don't exercise save/reminder flows,
// they just need the context lookup to succeed. `useLiveQuery` over
// fake-indexeddb returns null for an empty savedMessages store, which is
// exactly the "not saved" state these tests expect.
const noopSavedService: SavedService = {
  list: vi.fn().mockResolvedValue({ saved: [], nextCursor: null }),
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ServicesProvider services={{ saved: noopSavedService }}>
        <TooltipProvider>{children}</TooltipProvider>
      </ServicesProvider>
    </QueryClientProvider>
  )
}

describe("MessageEvent", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_123"

  describe("highlight animation", () => {
    it("should apply highlight animation when isHighlighted is true", () => {
      const event = createMessageEvent("msg_123", "Highlighted message")

      const { container } = render(
        <MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} isHighlighted={true} />,
        { wrapper: Wrapper }
      )

      const messageContainer = container.querySelector(".message-item")
      expect(messageContainer).toHaveClass("animate-highlight-flash")
    })

    it("should not apply highlight animation by default", () => {
      const event = createMessageEvent("msg_123", "Normal message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, {
        wrapper: Wrapper,
      })

      const messageContainer = container.querySelector(".message-item")
      expect(messageContainer).not.toHaveClass("animate-highlight-flash")
    })
  })

  describe("content rendering", () => {
    it("should render message content", () => {
      const event = createMessageEvent("msg_123", "Hello, world!")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      // Verify content is visible to user
      expect(screen.getByText("Hello, world!")).toBeInTheDocument()
    })

    it("should render actor name", () => {
      const event = createMessageEvent("msg_123", "Test message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      expect(screen.getByText("Test User")).toBeInTheDocument()
    })

    it("should render persona name for AI messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
        actorId: "persona_ariadne",
      }

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      expect(screen.getByText("Ariadne")).toBeInTheDocument()
    })
  })

  describe("reactions", () => {
    it("should render reaction pills when reactions are present", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "Reacted message"),
        payload: {
          messageId: "msg_123",
          contentMarkdown: "Reacted message",
          reactions: { "+1": ["member_123"], heart: ["member_456"] },
        },
      }

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      // Reaction pills show count
      const buttons = screen.getAllByRole("button")
      const reactionButtons = buttons.filter((b) => b.textContent?.match(/\d$/))
      expect(reactionButtons.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("visual differentiation", () => {
    it("should render Ariadne SVG icon for persona messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
        actorId: "persona_ariadne",
      }

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, {
        wrapper: Wrapper,
      })

      // Real AriadneIcon renders an SVG with aria-label
      const ariadneIcon = container.querySelector('svg[aria-label="Ariadne"]')
      expect(ariadneIcon).toBeInTheDocument()
    })

    it("should render user initials for user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      // User avatar shows initials from getActorAvatar
      expect(screen.getByText("TU")).toBeInTheDocument()
    })

    it("should apply gold accent styling to persona messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
      }

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, {
        wrapper: Wrapper,
      })

      const messageContainer = container.querySelector(".message-item")
      // Persona messages have gradient background and gold left accent
      expect(messageContainer).toHaveClass("bg-gradient-to-r")
      expect(messageContainer).toHaveClass("from-primary/[0.06]")
    })

    it("should not apply gold styling to user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, {
        wrapper: Wrapper,
      })

      const messageContainer = container.querySelector(".message-item")
      expect(messageContainer).not.toHaveClass("bg-gradient-to-r")
      expect(messageContainer).not.toHaveClass("from-primary/[0.06]")
    })
  })

  describe("ArrowUp edit-last-message trigger", () => {
    beforeAll(() => {
      // RichEditor is mocked at module level as vi.fn() — configure its implementation here
      ;(editorModule.RichEditor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          value,
          onChange,
          onSubmit,
          placeholder,
        }: {
          value: JSONContent
          onChange: (v: JSONContent) => void
          onSubmit: () => void
          placeholder?: string
        }) => (
          <textarea
            data-testid="rich-editor"
            defaultValue={JSON.stringify(value)}
            placeholder={placeholder}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value))
              } catch {
                /* ignore */
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                onSubmit()
              }
            }}
          />
        )
      )
      vi.spyOn(prosemirrorModule, "serializeToMarkdown").mockImplementation((json) => {
        return json.content?.[0]?.content?.[0]?.text ?? ""
      })
      vi.spyOn(prosemirrorModule, "parseMarkdown").mockImplementation((md) => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: md }] }],
      }))
    })

    afterAll(() => {
      // Restore prosemirror spies; reset RichEditor to module-level default (returns null)
      vi.restoreAllMocks()
      ;(editorModule.RichEditor as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null)
    })

    it("registers an edit handler and opens inline edit when it is called", async () => {
      const event = createMessageEvent("msg_edit", "Hello world")
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

      let capturedHandler: (() => void) | undefined
      const registerMessage = vi.fn((_messageId: string, handler: () => void) => {
        capturedHandler = handler
        return () => {}
      })

      render(
        <QueryClientProvider client={queryClient}>
          <ServicesProvider services={{ saved: noopSavedService }}>
            <TooltipProvider>
              <EditLastMessageContext.Provider value={{ registerMessage, triggerEditLast: vi.fn() }}>
                <MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />
              </EditLastMessageContext.Provider>
            </TooltipProvider>
          </ServicesProvider>
        </QueryClientProvider>
      )

      // Handler should be registered for this message
      expect(registerMessage).toHaveBeenCalledWith("msg_edit", expect.any(Function))

      // No edit form yet
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()

      // Calling the registered handler opens the inline edit form
      await act(async () => {
        capturedHandler?.()
      })
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    })

    it("does not open edit form when context is absent", () => {
      const event = createMessageEvent("msg_edit", "Hello world")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
    })

    it("restores focus to the visible zone editor after canceling inline edit", async () => {
      const event = createMessageEvent("msg_edit", "Hello world")
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const focusAtEnd = vi.mocked(hooksModule.focusAtEnd)
      focusAtEnd.mockClear()

      let capturedHandler: (() => void) | undefined
      const registerMessage = vi.fn((_messageId: string, handler: () => void) => {
        capturedHandler = handler
        return () => {}
      })

      render(
        <div data-editor-zone="main">
          <div data-testid="zone-editor" contentEditable />
          <QueryClientProvider client={queryClient}>
            <ServicesProvider services={{ saved: noopSavedService }}>
              <TooltipProvider>
                <EditLastMessageContext.Provider value={{ registerMessage, triggerEditLast: vi.fn() }}>
                  <MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />
                </EditLastMessageContext.Provider>
              </TooltipProvider>
            </ServicesProvider>
          </QueryClientProvider>
        </div>
      )

      const zoneEditor = screen.getByTestId("zone-editor")
      const rects = {
        length: 1,
        item: (index: number) => (index === 0 ? ({ width: 1, height: 1 } as DOMRect) : null),
        0: { width: 1, height: 1 } as DOMRect,
      } as unknown as DOMRectList
      vi.spyOn(zoneEditor, "getClientRects").mockReturnValue(rects)

      await act(async () => {
        capturedHandler?.()
      })

      await act(async () => {
        screen.getByRole("button", { name: "Cancel" }).click()
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      })

      expect(focusAtEnd).toHaveBeenCalledWith(zoneEditor)
    })
  })

  describe("pending message", () => {
    it("should show Sending indicator and Edit/Delete buttons on hover", () => {
      mockGetStatus = () => "pending"
      const event = createMessageEvent("msg_pending", "Pending message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      expect(screen.getByText("Sending...")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()
    })

    it("should call markEditing when Edit is clicked", async () => {
      mockGetStatus = () => "pending"
      mockMarkEditing.mockResolvedValue(undefined)
      const event = createMessageEvent("msg_pending", "Pending message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByRole("button", { name: "Edit" }))
      expect(mockMarkEditing).toHaveBeenCalledWith(event.id)
    })

    it("should call deleteMessage when Delete is clicked", async () => {
      mockGetStatus = () => "pending"
      mockDeleteMessage.mockResolvedValue(undefined)
      const event = createMessageEvent("msg_pending", "Pending message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByRole("button", { name: "Delete" }))
      expect(mockDeleteMessage).toHaveBeenCalledWith(event.id)
    })
  })

  describe("failed message", () => {
    it("should show Failed indicator and Retry/Edit/Delete buttons", () => {
      mockGetStatus = () => "failed"
      const event = createMessageEvent("msg_failed", "Failed message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      expect(screen.getByText("Failed to send")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()
    })

    it("should call retryMessage when Retry is clicked", async () => {
      mockGetStatus = () => "failed"
      mockRetryMessage.mockResolvedValue(undefined)
      const event = createMessageEvent("msg_failed", "Failed message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByRole("button", { name: "Retry" }))
      expect(mockRetryMessage).toHaveBeenCalledWith(event.id)
    })

    it("should call markEditing when Edit is clicked on failed message", async () => {
      mockGetStatus = () => "failed"
      mockMarkEditing.mockResolvedValue(undefined)
      const event = createMessageEvent("msg_failed", "Failed message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByRole("button", { name: "Edit" }))
      expect(mockMarkEditing).toHaveBeenCalledWith(event.id)
    })
  })

  describe("editing message", () => {
    it("should show editing indicator when status is editing", () => {
      mockGetStatus = () => "editing"
      const event = createMessageEvent("msg_editing", "Editing message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />, { wrapper: Wrapper })

      expect(screen.getByText("Editing unsent message")).toBeInTheDocument()
    })
  })
})
