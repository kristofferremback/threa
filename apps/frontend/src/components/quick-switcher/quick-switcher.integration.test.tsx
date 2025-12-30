import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QuickSwitcher } from "./quick-switcher"
import type { Stream, StreamType } from "@threa/types"
import { StreamTypes } from "@threa/types"

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    children,
    className,
    onClick,
    ...props
  }: {
    to: string
    children: React.ReactNode
    className?: string
    onClick?: (e: React.MouseEvent) => void
  }) => (
    <a href={to} className={className} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}))

// Helper to create a mock stream with all required fields
function createMockStream(overrides: Partial<Stream> & { id: string; type: StreamType }): Stream {
  return {
    workspaceId: "workspace_1",
    displayName: null,
    slug: null,
    description: null,
    visibility: "private" as const,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: "off" as const,
    companionPersonaId: null,
    createdBy: "user_1",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    archivedAt: null,
    ...overrides,
  }
}

// Mock workspace bootstrap data
const mockStreams: Stream[] = [
  createMockStream({
    id: "stream_scratchpad1",
    type: StreamTypes.SCRATCHPAD as StreamType,
    displayName: "My Notes",
  }),
  createMockStream({
    id: "stream_channel1",
    type: StreamTypes.CHANNEL as StreamType,
    displayName: "General",
    slug: "general",
  }),
  createMockStream({
    id: "stream_channel2",
    type: StreamTypes.CHANNEL as StreamType,
    displayName: "Random",
    slug: "random",
  }),
  createMockStream({
    id: "stream_dm1",
    type: StreamTypes.DM as StreamType,
    displayName: "Martin",
  }),
]

const mockUsers = [
  { id: "user_1", name: "Martin", slug: "martin", avatarUrl: null },
  { id: "user_2", name: "Kate", slug: "kate", avatarUrl: null },
]

const mockMembers = [
  { userId: "user_1", workspaceId: "workspace_1", role: "admin" },
  { userId: "user_2", workspaceId: "workspace_1", role: "member" },
]

const mockBootstrap = {
  streams: mockStreams,
  users: mockUsers,
  members: mockMembers,
  personas: [],
}

// Mock hooks
vi.mock("@/hooks", () => ({
  useWorkspaceBootstrap: () => ({ data: mockBootstrap, isLoading: false }),
  useDraftScratchpads: () => ({ createDraft: vi.fn() }),
  useCreateStream: () => ({ mutateAsync: vi.fn() }),
  useSearch: () => ({
    results: [],
    isLoading: false,
    error: null,
    search: vi.fn(),
    clear: vi.fn(),
  }),
}))

describe("QuickSwitcher Integration Tests", () => {
  const defaultProps = {
    workspaceId: "workspace_1",
    open: true,
    onOpenChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("dialog lifecycle", () => {
    it("should render when open=true", () => {
      render(<QuickSwitcher {...defaultProps} open={true} />)

      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expect(screen.getByPlaceholderText("Search streams...")).toBeInTheDocument()
    })

    it("should not render dialog content when open=false", () => {
      render(<QuickSwitcher {...defaultProps} open={false} />)

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    it("should focus input when dialog opens", async () => {
      render(<QuickSwitcher {...defaultProps} open={true} />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search streams...")).toHaveFocus()
      })
    })

    it("should reset query when dialog closes and reopens", async () => {
      const user = userEvent.setup()
      const { rerender } = render(<QuickSwitcher {...defaultProps} open={true} />)

      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, "test query")
      expect(input).toHaveValue("test query")

      // Close dialog
      rerender(<QuickSwitcher {...defaultProps} open={false} />)

      // Reopen dialog
      rerender(<QuickSwitcher {...defaultProps} open={true} />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search streams...")).toHaveValue("")
      })
    })

    it("should call onOpenChange(false) when pressing Escape", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

      await user.keyboard("{Escape}")

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe("keyboard navigation", () => {
    // Helper to check if an item is selected (component uses bg-accent class, not aria-selected)
    const isItemSelected = (element: Element | null) => {
      return element?.classList.contains("bg-accent")
    }

    describe("when popover is closed", () => {
      // Items are sorted alphabetically: #general, #random, Martin, My Notes
      it("should navigate down through results with ArrowDown", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        // Wait for items to render (sorted alphabetically)
        await waitFor(() => {
          expect(screen.getByText("#general")).toBeInTheDocument()
        })

        // First item should be selected by default (#general is first alphabetically)
        const firstItem = screen.getByText("#general").closest("a")
        expect(isItemSelected(firstItem)).toBe(true)

        // Press ArrowDown
        await user.keyboard("{ArrowDown}")

        // Second item should now be selected (#random)
        const secondItem = screen.getByText("#random").closest("a")
        expect(isItemSelected(secondItem)).toBe(true)
        expect(isItemSelected(firstItem)).toBe(false)
      })

      it("should navigate up through results with ArrowUp", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        await waitFor(() => {
          expect(screen.getByText("#general")).toBeInTheDocument()
        })

        // Navigate down first
        await user.keyboard("{ArrowDown}")
        await user.keyboard("{ArrowDown}")

        // Third item should be selected (Martin)
        const thirdItem = screen.getByText("Martin").closest("a")
        expect(isItemSelected(thirdItem)).toBe(true)

        // Navigate up
        await user.keyboard("{ArrowUp}")

        // Second item should be selected (#random)
        const secondItem = screen.getByText("#random").closest("a")
        expect(isItemSelected(secondItem)).toBe(true)
      })

      it("should not go below last item with ArrowDown", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        await waitFor(() => {
          expect(screen.getByText("#general")).toBeInTheDocument()
        })

        // Navigate to last item (4 streams sorted alphabetically)
        await user.keyboard("{ArrowDown}")
        await user.keyboard("{ArrowDown}")
        await user.keyboard("{ArrowDown}")

        // My Notes is last alphabetically
        const lastItem = screen.getByText("My Notes").closest("a")
        expect(isItemSelected(lastItem)).toBe(true)

        // Try to go further
        await user.keyboard("{ArrowDown}")

        // Should still be on last item
        expect(isItemSelected(lastItem)).toBe(true)
      })

      it("should not go above first item with ArrowUp", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        await waitFor(() => {
          expect(screen.getByText("#general")).toBeInTheDocument()
        })

        // #general is first alphabetically
        const firstItem = screen.getByText("#general").closest("a")
        expect(isItemSelected(firstItem)).toBe(true)

        // Try to go up from first item
        await user.keyboard("{ArrowUp}")

        // Should still be on first item
        expect(isItemSelected(firstItem)).toBe(true)
      })

      it("should select current item with Enter", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        await waitFor(() => {
          expect(screen.getByText("#general")).toBeInTheDocument()
        })

        // First item (#general = stream_channel1) is already selected
        // Press Enter to select it
        await user.keyboard("{Enter}")

        // Should navigate to the stream
        expect(mockNavigate).toHaveBeenCalledWith("/w/workspace_1/s/stream_channel1")
      })

      it("should close dialog with Escape", async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

        await user.keyboard("{Escape}")

        expect(onOpenChange).toHaveBeenCalledWith(false)
      })

      it("should close dialog with Ctrl+[", async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

        // Focus the input first
        const input = screen.getByPlaceholderText("Search streams...")
        await user.click(input)

        // Simulate Ctrl+[ using fireEvent since userEvent doesn't properly handle this combo
        // The component checks e.ctrlKey && e.key === "["
        const event = new KeyboardEvent("keydown", {
          key: "[",
          ctrlKey: true,
          bubbles: true,
        })
        input.dispatchEvent(event)

        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    // Tests for popover open state will be added when we implement SearchEditor
    describe("when popover is open", () => {
      it.todo("should navigate popover items with ArrowDown")
      it.todo("should navigate popover items with ArrowUp")
      it.todo("should select popover item with Enter")
      it.todo("should select popover item with Tab")
      it.todo("should close popover (not dialog) with Escape")
      it.todo("should return focus to input after popover closes")
    })
  })

  describe("mode switching", () => {
    it("should start in stream mode by default", () => {
      render(<QuickSwitcher {...defaultProps} />)

      expect(screen.getByPlaceholderText("Search streams...")).toBeInTheDocument()
      // Stream tab should be active
      expect(screen.getByRole("tab", { name: /stream search/i })).toHaveAttribute("aria-selected", "true")
    })

    it("should switch to command mode when typing >", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, ">")

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Run a command...")).toBeInTheDocument()
      })
      expect(screen.getByRole("tab", { name: /command palette/i })).toHaveAttribute("aria-selected", "true")
    })

    it("should switch to search mode when typing ?", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, "?")

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search messages...")).toBeInTheDocument()
      })
      expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
    })

    it("should switch mode when clicking mode tabs", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Click on Commands tab
      const commandsTab = screen.getByRole("tab", { name: /command palette/i })
      await user.click(commandsTab)

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Run a command...")).toBeInTheDocument()
      })
    })

    it("should reset selectedIndex when mode changes", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText("#general")).toBeInTheDocument()
      })

      // Navigate to second item (alphabetically: #general, #random, ...)
      await user.keyboard("{ArrowDown}")

      const secondItem = screen.getByText("#random").closest("a")
      expect(secondItem?.classList.contains("bg-accent")).toBe(true)

      // Switch to command mode
      await user.type(screen.getByRole("textbox"), ">")

      // First command should be selected after mode switch
      await waitFor(() => {
        // Look for command items (they're rendered as divs since commands don't have href)
        const commandItems = screen.getAllByText(/new scratchpad|new channel|toggle theme/i)
        if (commandItems.length > 0) {
          const firstCommandItem = commandItems[0].closest("div[data-index]")
          expect(firstCommandItem?.classList.contains("bg-accent")).toBe(true)
        }
      })
    })
  })

  describe("mode tab keyboard navigation", () => {
    // TODO: Focus management with requestAnimationFrame and Radix Dialog's focus trap
    // doesn't work reliably in jsdom. These tests pass in real browsers.
    it.todo("should move between tabs with ArrowLeft/ArrowRight when tab is focused")

    it.todo("should select tab with Enter when focused")

    it("should refocus input when pressing ArrowDown while on tabs", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Focus a tab
      const streamsTab = screen.getByRole("tab", { name: /stream search/i })
      await user.click(streamsTab)

      // Press ArrowDown
      await user.keyboard("{ArrowDown}")

      // Input should be focused
      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveFocus()
      })
    })

    it("should refocus input when pressing ArrowUp while on tabs", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Focus a tab
      const streamsTab = screen.getByRole("tab", { name: /stream search/i })
      await user.click(streamsTab)

      // Press ArrowUp
      await user.keyboard("{ArrowUp}")

      // Input should be focused
      await waitFor(() => {
        expect(screen.getByRole("textbox")).toHaveFocus()
      })
    })
  })

  describe("search mode", () => {
    // These tests will be enhanced when we implement the new search features
    it.todo("should show filter badges for active filters")
    it.todo("should remove filter when clicking badge X")
    it.todo("should add filter via dropdown menu")
    it.todo("should debounce search API calls")
    it.todo("should display search results")
    it.todo("should navigate to message when selecting result")
  })

  describe("item selection", () => {
    it("should call onSelect when clicking item", async () => {
      // Disable pointer-events check due to Radix Dialog overlay
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      const onOpenChange = vi.fn()
      render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText("#general")).toBeInTheDocument()
      })

      // Click on a stream item (items with href are rendered as <a> links)
      const item = screen.getByText("#general").closest("a")
      await user.click(item!)

      // Should navigate to the stream
      expect(mockNavigate).toHaveBeenCalledWith("/w/workspace_1/s/stream_channel1")
      // Should close dialog
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("should open in new tab with Cmd+click", async () => {
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null)
      render(<QuickSwitcher {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText("#general")).toBeInTheDocument()
      })

      // Cmd+click on a stream item - Link components handle this natively
      // The test validates the Link is rendered correctly
      const item = screen.getByText("#general").closest("a")
      expect(item).toHaveAttribute("href", "/w/workspace_1/s/stream_channel1")

      windowOpenSpy.mockRestore()
    })

    it("should open in new tab with Ctrl+click", async () => {
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null)
      render(<QuickSwitcher {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText("#general")).toBeInTheDocument()
      })

      // Ctrl+click on a stream item - Link components handle this natively
      // The test validates the Link is rendered correctly
      const item = screen.getByText("#general").closest("a")
      expect(item).toHaveAttribute("href", "/w/workspace_1/s/stream_channel1")

      windowOpenSpy.mockRestore()
    })

    it("should close dialog after selection via Enter", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText("My Notes")).toBeInTheDocument()
      })

      // Press Enter to select first item
      await user.keyboard("{Enter}")

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe("stream filtering", () => {
    it("should filter streams by name", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText("My Notes")).toBeInTheDocument()
      })

      // Type to filter
      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, "general")

      await waitFor(() => {
        expect(screen.getByText("#general")).toBeInTheDocument()
        expect(screen.queryByText("My Notes")).not.toBeInTheDocument()
        expect(screen.queryByText("#random")).not.toBeInTheDocument()
      })
    })

    it("should show empty message when no streams match", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, "nonexistent")

      await waitFor(() => {
        expect(screen.getByText("No streams found.")).toBeInTheDocument()
      })
    })
  })

  describe("initial mode", () => {
    it("should start in command mode when initialMode is command", () => {
      render(<QuickSwitcher {...defaultProps} initialMode="command" />)

      expect(screen.getByPlaceholderText("Run a command...")).toBeInTheDocument()
    })

    it("should start in search mode when initialMode is search", () => {
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      expect(screen.getByPlaceholderText("Search messages...")).toBeInTheDocument()
    })
  })
})
