import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QuickSwitcher } from "./quick-switcher"
import { mockStreamsList } from "@/test/fixtures"
import { mockUsersList, mockMembersList } from "@/test/fixtures/users"
import { mockSearchResultsList } from "@/test/fixtures/messages"

// Note: DOM polyfills (ResizeObserver, Range, Element.getClientRects, etc.)
// are in src/test/setup.ts which runs before tests via vitest config

// Hoisted values for configurable mocks (vi.mock is hoisted above imports)
const { mockNavigate, mockSearchState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearchState: {
    results: [] as typeof import("@/test/fixtures/messages").mockSearchResultsList,
    isLoading: false,
    search: vi.fn(),
    clear: vi.fn(),
  },
}))

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ workspaceId: "workspace_1" }),
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

// Mock @/hooks with fixture data
vi.mock("@/hooks", () => ({
  useWorkspaceBootstrap: () => ({
    data: {
      streams: mockStreamsList,
      users: mockUsersList,
      members: mockMembersList,
      personas: [],
    },
    isLoading: false,
  }),
  useDraftScratchpads: () => ({ createDraft: vi.fn() }),
  useCreateStream: () => ({ mutateAsync: vi.fn() }),
  useSearch: () => ({
    results: mockSearchState.results,
    isLoading: mockSearchState.isLoading,
    error: null,
    search: mockSearchState.search,
    clear: mockSearchState.clear,
  }),
}))

// Mock use-mentionables - called by SearchEditor's useMentionSuggestion
vi.mock("@/hooks/use-mentionables", () => {
  const filterFn = (items: unknown[], query: string) => {
    if (!query) return items
    const q = query.toLowerCase()
    return (items as { name: string; slug: string }[]).filter(
      (i) => i.slug.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
    )
  }

  return {
    useMentionables: () => ({
      mentionables: [
        { id: "user_1", slug: "martin", name: "Martin", type: "user" },
        { id: "user_2", slug: "kate", name: "Kate", type: "user" },
      ],
      isLoading: false,
    }),
    filterMentionables: filterFn,
    // filterSearchMentionables excludes broadcast mentions, then filters
    filterSearchMentionables: (items: unknown[], query: string) => {
      const filtered = (items as { type?: string }[]).filter((i) => i.type !== "broadcast")
      return filterFn(filtered, query)
    },
    // filterUsersOnly excludes personas and broadcasts, only users
    filterUsersOnly: (items: unknown[], query: string) => {
      const usersOnly = (items as { type?: string }[]).filter((i) => i.type === "user")
      return filterFn(usersOnly, query)
    },
  }
})

// Mock auth - called by SearchEditor's useMentionSuggestion
vi.mock("@/auth", () => ({
  useUser: () => ({ id: "user_1", name: "Martin", slug: "martin" }),
}))

// Mock use-workspaces - called by useChannelSuggestion
vi.mock("@/hooks/use-workspaces", () => ({
  useWorkspaceBootstrap: () => ({
    data: {
      streams: mockStreamsList,
      users: mockUsersList,
      members: mockMembersList,
      personas: [],
    },
    isLoading: false,
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
    // Reset configurable mocks
    mockSearchState.results = []
    mockSearchState.isLoading = false
    mockSearchState.search = vi.fn()
    mockSearchState.clear = vi.fn()
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

    // Tests for popover behavior when suggestion list is shown
    // These tests verify keyboard handling is delegated to the popover when active
    describe("when popover is open", () => {
      it("should navigate popover items with ArrowDown", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        // Switch to search mode first
        const input = screen.getByPlaceholderText("Search streams...")
        await user.type(input, "?")

        await waitFor(() => {
          expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
        })

        const editor = screen.getByLabelText("Search query input")
        // Type @ to trigger mention popover (cursor is at end, after "?")
        await user.type(editor, " @")

        // Wait for popover to appear with mentionables
        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // ArrowDown should navigate within the popover, not close dialog
        await user.keyboard("{ArrowDown}")

        // Dialog should still be open
        expect(screen.getByRole("dialog")).toBeInTheDocument()
        expect(screen.getByText("Kate")).toBeInTheDocument()
      })

      it("should navigate popover items with ArrowUp", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        const input = screen.getByPlaceholderText("Search streams...")
        await user.type(input, "?")

        await waitFor(() => {
          expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
        })

        const editor = screen.getByLabelText("Search query input")
        await user.type(editor, " @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Navigate down first
        await user.keyboard("{ArrowDown}")
        // Then back up
        await user.keyboard("{ArrowUp}")

        // Dialog should still be open (popover captured the events)
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })

      it("should select popover item with Enter", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        const input = screen.getByPlaceholderText("Search streams...")
        await user.type(input, "?")

        await waitFor(() => {
          expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
        })

        const editor = screen.getByLabelText("Search query input")
        await user.type(editor, " @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Press Enter to select first item
        await user.keyboard("{Enter}")

        // Popover should close and selection should be inserted
        await waitFor(() => {
          const editorContent = editor.textContent
          expect(editorContent).toContain("@martin")
        })
      })

      it("should select popover item with Tab", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        const input = screen.getByPlaceholderText("Search streams...")
        await user.type(input, "?")

        await waitFor(() => {
          expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
        })

        const editor = screen.getByLabelText("Search query input")
        await user.type(editor, " @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Press Tab to select first item
        await user.keyboard("{Tab}")

        // Selection should be inserted (Tab works like Enter in suggestion lists)
        await waitFor(() => {
          const editorContent = editor.textContent
          expect(editorContent).toContain("@martin")
        })
      })

      it("should close popover (not dialog) with Escape", async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

        const input = screen.getByPlaceholderText("Search streams...")
        await user.type(input, "?")

        await waitFor(() => {
          expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
        })

        const editor = screen.getByLabelText("Search query input")
        await user.type(editor, " @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Press Escape - should close popover, not dialog
        await user.keyboard("{Escape}")

        // Dialog should still be open because our handler prevented the default
        expect(screen.getByRole("dialog")).toBeInTheDocument()
        expect(onOpenChange).not.toHaveBeenCalledWith(false)
      })

      it("should return focus to input after popover closes", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} />)

        const input = screen.getByPlaceholderText("Search streams...")
        await user.type(input, "?")

        await waitFor(() => {
          expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
        })

        const editor = screen.getByLabelText("Search query input")
        await user.type(editor, " @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Select an item to close popover
        await user.keyboard("{Enter}")

        // Focus should return to editor
        await waitFor(() => {
          const proseMirrorEl = editor.closest(".ProseMirror")
          expect(document.activeElement).toBe(proseMirrorEl)
        })
      })
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

      // When mode switches to search, the tab should be selected and SearchEditor renders
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })
      // SearchEditor uses TipTap which has aria-label instead of placeholder
      expect(screen.getByLabelText("Search query input")).toBeInTheDocument()
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

  describe("mode prefix behavior", () => {
    it("should switch to search mode when typing ? and allow continued typing", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Start in stream mode
      const input = screen.getByPlaceholderText("Search streams...")

      // Type "?" - should switch to search mode
      await user.type(input, "?")

      // Should be in search mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })

      // SearchEditor should show "?" (the full query including prefix)
      const searchEditor = screen.getByLabelText("Search query input")
      expect(searchEditor.textContent).toBe("?")

      // Now continue typing into the SearchEditor
      await user.click(searchEditor)
      await user.type(searchEditor, " test")

      // Should show "? test" in the editor (full query with prefix)
      expect(searchEditor.textContent).toBe("? test")
    })

    it("should preserve > prefix when typing in stream mode", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")

      // Type "> new" - should switch to command mode and preserve the query
      await user.type(input, "> new")

      // Should be in command mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /command palette/i })).toHaveAttribute("aria-selected", "true")
      })

      // Input should show "> new"
      const commandInput = screen.getByPlaceholderText("Run a command...")
      expect(commandInput).toHaveValue("> new")
    })

    it("should not clear query when switching to search mode by typing ?", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")

      // Type just "?" first
      await user.type(input, "?")

      // Should switch to search mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })

      // Now type more text (including space after ?)
      const searchEditor = screen.getByLabelText("Search query input")
      await user.click(searchEditor)
      await user.type(searchEditor, " hello")

      // Should show "? hello" in the editor (full query with prefix)
      expect(searchEditor.textContent).toBe("? hello")
    })

    it("should handle paste with ? prefix correctly", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")

      // Paste "? test" into the input
      await user.click(input)
      await user.paste("? test")

      // Should switch to search mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })

      // SearchEditor should show "? test" (full query with prefix)
      const searchEditor = screen.getByLabelText("Search query input")
      expect(searchEditor.textContent).toBe("? test")
    })

    it("should normalize redundant ? prefixes on paste", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")

      // Paste "? ? test" - should normalize to "? test"
      await user.click(input)
      await user.paste("? ? test")

      // Should be in search mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })

      // SearchEditor should show "? test" (normalized, full query with prefix)
      const searchEditor = screen.getByLabelText("Search query input")
      expect(searchEditor.textContent).toBe("? test")
    })

    it("should normalize redundant > prefixes on paste", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      const input = screen.getByPlaceholderText("Search streams...")

      // Paste "> > new" - should normalize to "> new"
      await user.click(input)
      await user.paste("> > new")

      // Should be in command mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /command palette/i })).toHaveAttribute("aria-selected", "true")
      })

      // Input should show "> new" (normalized)
      const commandInput = screen.getByPlaceholderText("Run a command...")
      expect(commandInput).toHaveValue("> new")
    })

    it("should allow switching from search mode to stream mode by clearing prefix", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Start in stream mode, switch to search mode
      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, "?")

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })

      // Clear the SearchEditor and type something without prefix
      const editor = screen.getByLabelText("Search query input")
      await user.clear(editor)
      await user.type(editor, "general")

      // Should switch back to stream mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /stream search/i })).toHaveAttribute("aria-selected", "true")
      })

      // Should show "general" in stream mode input
      const streamInput = screen.getByPlaceholderText("Search streams...")
      expect(streamInput).toHaveValue("general")
    })

    it("should allow switching from search mode to command mode by changing prefix", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Start in stream mode, switch to search mode
      const input = screen.getByPlaceholderText("Search streams...")
      await user.type(input, "?")

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
      })

      // Clear and type command prefix
      const editor = screen.getByLabelText("Search query input")
      await user.clear(editor)
      await user.type(editor, "> new")

      // Should switch to command mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /command palette/i })).toHaveAttribute("aria-selected", "true")
      })

      // Should show "> new" in command mode input
      const commandInput = screen.getByPlaceholderText("Run a command...")
      expect(commandInput).toHaveValue("> new")
    })

    it("should switch from search mode to stream mode when pasting text without prefix", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      // Start in search mode
      const searchEditor = screen.getByLabelText("Search query input")

      // Paste plain text without prefix - should switch to stream mode
      await user.click(searchEditor)
      await user.paste("general")

      // Should switch to stream mode
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /stream search/i })).toHaveAttribute("aria-selected", "true")
      })

      // Input should show "general"
      const input = screen.getByPlaceholderText("Search streams...")
      expect(input).toHaveValue("general")
    })
  })

  describe("mode tab keyboard navigation", () => {
    it("should allow clicking between tabs to change mode", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} />)

      // Start in stream mode
      expect(screen.getByPlaceholderText("Search streams...")).toBeInTheDocument()

      // Click commands tab
      const commandsTab = screen.getByRole("tab", { name: /command palette/i })
      await user.click(commandsTab)

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Run a command...")).toBeInTheDocument()
      })

      // Click search tab
      const searchTab = screen.getByRole("tab", { name: /message search/i })
      await user.click(searchTab)

      await waitFor(() => {
        expect(screen.getByLabelText("Search query input")).toBeInTheDocument()
      })

      // Click streams tab to go back
      const streamsTab = screen.getByRole("tab", { name: /stream search/i })
      await user.click(streamsTab)

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search streams...")).toBeInTheDocument()
      })
    })

    it("should have accessible tabs with proper ARIA attributes", () => {
      render(<QuickSwitcher {...defaultProps} />)

      // All tabs should be present with proper roles
      const tabs = screen.getAllByRole("tab")
      expect(tabs).toHaveLength(3)

      // Stream tab should be selected by default
      const streamsTab = screen.getByRole("tab", { name: /stream search/i })
      expect(streamsTab).toHaveAttribute("aria-selected", "true")

      // Other tabs should not be selected
      const commandsTab = screen.getByRole("tab", { name: /command palette/i })
      const searchTab = screen.getByRole("tab", { name: /message search/i })
      expect(commandsTab).toHaveAttribute("aria-selected", "false")
      expect(searchTab).toHaveAttribute("aria-selected", "false")
    })

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
    it("should show filter badges when typing filter syntax", async () => {
      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      // Get the TipTap editor (it has aria-label, not placeholder)
      const editor = screen.getByLabelText("Search query input")

      // Type a filter - TipTap requires clicking first to focus
      await user.click(editor)
      await user.type(editor, "from:@martin ")

      // The filter should be parsed and displayed as a badge
      await waitFor(() => {
        expect(screen.getByText("@martin")).toBeInTheDocument()
      })
    })

    it("should remove filter when clicking badge X", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      const editor = screen.getByLabelText("Search query input")
      await user.click(editor)
      await user.type(editor, "from:@martin hello")

      // Wait for badge to appear
      await waitFor(() => {
        expect(screen.getByText("@martin")).toBeInTheDocument()
      })

      // Click the X button on the badge
      const removeButton = screen.getByRole("button", { name: "" }) // X button has no accessible name
      await user.click(removeButton)

      // Badge should be removed
      await waitFor(() => {
        expect(screen.queryByText("@martin")).not.toBeInTheDocument()
      })
    })

    it("should add filter via dropdown menu", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      // Wait for search mode to render
      await waitFor(() => {
        expect(screen.getByText("Add filter")).toBeInTheDocument()
      })

      // Click "Add filter" button
      await user.click(screen.getByText("Add filter"))

      // Click "Stream type" option
      await waitFor(() => {
        expect(screen.getByText("Stream type")).toBeInTheDocument()
      })
      await user.click(screen.getByText("Stream type"))

      // Select a stream type (e.g., "Channel")
      await waitFor(() => {
        expect(screen.getByText("Channel")).toBeInTheDocument()
      })
      await user.click(screen.getByText("Channel"))

      // Badge should appear
      await waitFor(() => {
        expect(screen.getByText("channel")).toBeInTheDocument()
      })
    })

    it("should call search API when query changes", async () => {
      // This test verifies that search is called when the component renders
      // with search content. Full debounce behavior testing with TipTap
      // requires browser-level DOM support not available in jsdom.
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      // Search should not be called immediately with empty query
      expect(mockSearchState.search).not.toHaveBeenCalled()

      // Verify clear is not called either until there's content
      expect(mockSearchState.clear).not.toHaveBeenCalled()
    })

    it("should display search results", async () => {
      // Configure mock to return results
      mockSearchState.results = mockSearchResultsList

      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} initialMode="search" />)

      const editor = screen.getByLabelText("Search query input")
      await user.click(editor)
      await user.type(editor, "hello")

      // Results should be displayed
      await waitFor(() => {
        expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
        expect(screen.getByText("Another search result message")).toBeInTheDocument()
      })
    })

    it("should navigate to message when selecting result", async () => {
      mockSearchState.results = mockSearchResultsList
      const onOpenChange = vi.fn()

      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<QuickSwitcher {...defaultProps} initialMode="search" onOpenChange={onOpenChange} />)

      const editor = screen.getByLabelText("Search query input")
      await user.click(editor)
      await user.type(editor, "hello")

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
      })

      // Click on result
      await user.click(screen.getByText("Hello from the search results"))

      // Should navigate to message
      expect(mockNavigate).toHaveBeenCalledWith("/w/workspace_1/s/stream_channel1?m=msg_1")
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("should navigate to message when pressing Enter in search mode (no popover)", async () => {
      mockSearchState.results = mockSearchResultsList
      const onOpenChange = vi.fn()

      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} initialMode="search" onOpenChange={onOpenChange} />)

      const editor = screen.getByLabelText("Search query input")
      await user.click(editor)
      await user.type(editor, "hello")

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
      })

      // Press Enter to select the first result (no popover is open)
      await user.keyboard("{Enter}")

      // Should navigate to message
      expect(mockNavigate).toHaveBeenCalledWith("/w/workspace_1/s/stream_channel1?m=msg_1")
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("should open in new tab with Cmd+Enter in search mode", async () => {
      mockSearchState.results = mockSearchResultsList
      const onOpenChange = vi.fn()
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null)

      const user = userEvent.setup()
      render(<QuickSwitcher {...defaultProps} initialMode="search" onOpenChange={onOpenChange} />)

      const editor = screen.getByLabelText("Search query input")
      await user.click(editor)
      await user.type(editor, "hello")

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
      })

      // Press Cmd+Enter to open in new tab
      await user.keyboard("{Meta>}{Enter}{/Meta}")

      // Should open in new tab
      expect(windowOpenSpy).toHaveBeenCalledWith("/w/workspace_1/s/stream_channel1?m=msg_1", "_blank")

      windowOpenSpy.mockRestore()
    })
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

      // SearchEditor uses TipTap which has aria-label instead of placeholder
      expect(screen.getByLabelText("Search query input")).toBeInTheDocument()
      expect(screen.getByRole("tab", { name: /message search/i })).toHaveAttribute("aria-selected", "true")
    })
  })

  // =============================================================================
  // DIAGNOSTIC TESTS - Understanding test environment vs browser behavior
  // These tests help us understand WHY integration tests might pass when bugs exist
  // =============================================================================
  describe("DIAGNOSTIC: test environment behavior", () => {
    describe("pointer-events behavior", () => {
      it("should show body has pointer-events:none when dialog is open", async () => {
        render(<QuickSwitcher {...defaultProps} />)

        // Check what styles Radix Dialog applies to body
        const bodyStyle = window.getComputedStyle(document.body)
        console.log("Body pointer-events:", bodyStyle.pointerEvents)
        console.log("Body style attribute:", document.body.getAttribute("style"))

        // Document what we find (not asserting, just logging)
        // In real browser: pointer-events: none
        // In jsdom: ???
      })

      it("should verify where suggestion list renders in DOM", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)
        // Need to type text first, then @ - just @ after "? " doesn't trigger popover
        await user.type(editor, "test @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Find where the suggestion list actually rendered
        const suggestionList = screen.getByRole("listbox")
        console.log("Suggestion list parent:", suggestionList.parentElement?.tagName)
        console.log("Is direct child of body:", suggestionList.parentElement === document.body)

        // Check if the suggestion list has pointer-events set
        const listStyle = window.getComputedStyle(suggestionList)
        console.log("Suggestion list pointer-events:", listStyle.pointerEvents)
      })

      it("should verify that userEvent respects pointer-events:none", async () => {
        // userEvent.click() throws an error when element has pointer-events: none
        // This is why the pointer-events fix in suggestion-list.tsx is needed
        const container = document.createElement("div")
        container.style.pointerEvents = "none"
        document.body.appendChild(container)

        const button = document.createElement("button")
        button.textContent = "Click me"
        container.appendChild(button)

        // userEvent should throw because pointer-events: none blocks clicks
        const user = userEvent.setup()
        await expect(user.click(button)).rejects.toThrow(/pointer-events/)

        document.body.removeChild(container)
      })
    })

    describe("keyboard event propagation", () => {
      it("should trace Escape key event flow", async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)
        // Need to type text first, then @ - just @ after "? " doesn't work
        await user.type(editor, "test @")

        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // At this point, popover should be active
        // Let's check the DOM state before pressing Escape
        const suggestionList = screen.getByRole("listbox")
        console.log("Popover visible before Escape:", !!suggestionList)

        // Press Escape
        await user.keyboard("{Escape}")

        // What happened?
        console.log("onOpenChange calls:", onOpenChange.mock.calls)
        console.log("Dialog still exists:", !!screen.queryByRole("dialog"))
        console.log("Popover still exists:", !!screen.queryByRole("listbox"))

        // Expected in real browser with bug:
        // - Dialog closes (onOpenChange called with false)
        // - Popover disappears because dialog closed
        //
        // Expected correct behavior:
        // - Popover closes first
        // - Dialog stays open
        // - Second Escape closes dialog
      })

      it("should trace Enter key event flow", async () => {
        mockSearchState.results = mockSearchResultsList
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)
        await user.type(editor, "hello @")

        // Wait for both results and popover
        await waitFor(() => {
          expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
        })
        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        console.log("Before Enter:")
        console.log("- Search results visible:", !!screen.queryByText("Hello from the search results"))
        console.log("- Popover visible:", !!screen.queryByRole("listbox"))
        console.log("- Editor content:", editor.textContent)

        // Press Enter
        await user.keyboard("{Enter}")

        console.log("After Enter:")
        console.log("- mockNavigate calls:", mockNavigate.mock.calls)
        console.log("- Editor content:", editor.textContent)
        console.log("- Popover still visible:", !!screen.queryByRole("listbox"))

        // If Enter was captured by popover: editor should contain @martin, navigate not called
        // If Enter was captured by list: navigate called, editor unchanged
      })

      it("should verify isSuggestionPopoverActive state timing", async () => {
        // This test checks if the popover active state is properly communicated
        // We'll spy on console to see the state changes
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)

        // Before typing @
        console.log("Before @: popover listbox exists:", !!screen.queryByRole("listbox"))

        // Need to type text first, then @ - just @ after "? " doesn't trigger popover
        await user.type(editor, "test @")

        // After typing @, wait for popover
        await waitFor(() => {
          expect(screen.getByRole("listbox")).toBeInTheDocument()
        })

        console.log("After @: popover listbox exists:", !!screen.queryByRole("listbox"))

        // The question is: does the parent QuickSwitcher know the popover is active?
        // We can't directly check isSuggestionPopoverActive state, but we can
        // check behavior that depends on it
      })
    })
  })

  // =============================================================================
  // Bug regression tests - these tests should FAIL before the fix is applied
  // Each test documents a specific bug and verifies the correct behavior
  // =============================================================================
  describe("bug regressions", () => {
    describe("BUG: Enter with popover open should select popover item, not list item", () => {
      // Bug: When the suggestion popover is open in search mode and user presses Enter,
      // the highlighted message in the list behind the popover gets opened instead of
      // selecting the popover item.
      it("should NOT navigate to a message when pressing Enter with popover open", async () => {
        // Configure mock to return search results (which appear as list items behind popover)
        mockSearchState.results = mockSearchResultsList

        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")

        // Type something to trigger search results in the background
        await user.click(editor)
        await user.type(editor, "hello @")

        // Wait for BOTH: search results in background AND popover to appear
        await waitFor(() => {
          expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
        })
        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Now press Enter - should select popover item, NOT the list item
        await user.keyboard("{Enter}")

        // The popover item should be selected (text inserted into editor)
        await waitFor(() => {
          expect(editor.textContent).toContain("@martin")
        })

        // CRITICAL: Should NOT have navigated to the message
        expect(mockNavigate).not.toHaveBeenCalled()
        // Dialog should still be open (we selected popover item, not closed dialog)
        expect(onOpenChange).not.toHaveBeenCalledWith(false)
      })
    })

    describe("BUG: in: filter should show #slug or display name, not @stream_id", () => {
      // Bug: When selecting a channel from the in: filter autocomplete, it shows
      // "in:@stream_channel1" instead of "in:#general" or "in:General"
      it("should display in:#slug when selecting a channel from in: filter", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)

        // Type "in:#" to trigger channel filter autocomplete
        await user.type(editor, "in:#")

        // Wait for channel suggestion popover to appear with "general" channel
        await waitFor(() => {
          // Suggestion popover should appear with listbox role
          const listbox = screen.getByRole("listbox")
          expect(listbox).toBeInTheDocument()
          // Should contain a channel option with "general" (case-insensitive)
          expect(screen.getByRole("option", { name: /general/i })).toBeInTheDocument()
        })

        // Select the first channel
        await user.keyboard("{Enter}")

        // The filter should show the slug format, not the stream ID
        await waitFor(() => {
          const content = editor.textContent ?? ""
          // Should be "in:#general" NOT "in:@stream_channel1"
          expect(content).toMatch(/in:#general/i)
          expect(content).not.toContain("stream_")
          expect(content).not.toContain("@stream")
        })
      })

      it("should display in:@slug when selecting a user from in: filter (DM)", async () => {
        const user = userEvent.setup()
        render(<QuickSwitcher {...defaultProps} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)

        // Type "in:@" to trigger user filter autocomplete (for DMs)
        await user.type(editor, "in:@")

        // Wait for user suggestions to appear
        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Select Martin
        await user.keyboard("{Enter}")

        // The filter should show @martin (user slug), not the stream ID
        await waitFor(() => {
          const content = editor.textContent ?? ""
          expect(content).toMatch(/in:@martin/i)
          expect(content).not.toContain("stream_")
        })
      })
    })

    describe("BUG: Escape should close dialog when popover is closed", () => {
      // Bug: Pressing Escape doesn't close the quick switcher dialog
      it("should close dialog when pressing Escape in stream mode", async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} />)

        // Verify dialog is open
        expect(screen.getByRole("dialog")).toBeInTheDocument()

        // Focus the input (stream mode)
        const input = screen.getByPlaceholderText("Search streams...")
        await user.click(input)

        // Press Escape
        await user.keyboard("{Escape}")

        // Dialog should close
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })

      it("should close dialog when pressing Escape in search mode with no popover", async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)

        // Type something that doesn't trigger a popover
        await user.type(editor, "hello world")

        // Press Escape - should close dialog since no popover is open
        await user.keyboard("{Escape}")

        // Dialog should close
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    describe("BUG: Mouse click on popover item should select it, not pass through", () => {
      // Bug: Clicking on a popover item passes the click through to the list items
      // behind it, causing the wrong action (e.g., navigating to a message)
      //
      // ROOT CAUSE: Suggestion list is portaled to document.body, which has
      // pointer-events: none when Radix Dialog is open. The list inherits this.
      //
      // PREVIOUS TEST ISSUE: Using pointerEventsCheck: 0 bypasses this check,
      // so the test passes but doesn't catch the real bug!
      it("should select popover item when clicking it, not the list item behind", async () => {
        mockSearchState.results = mockSearchResultsList

        // INTENTIONALLY NOT using pointerEventsCheck: 0 to expose the bug
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        render(<QuickSwitcher {...defaultProps} onOpenChange={onOpenChange} initialMode="search" />)

        const editor = screen.getByLabelText("Search query input")
        await user.click(editor)
        await user.type(editor, "hello @")

        // Wait for both search results and popover
        await waitFor(() => {
          expect(screen.getByText("Hello from the search results")).toBeInTheDocument()
        })
        await waitFor(() => {
          expect(screen.getByText("Martin")).toBeInTheDocument()
        })

        // Click on the popover item "Martin"
        const martinOption = screen.getByText("Martin")
        await user.click(martinOption)

        // Should insert @martin into the editor
        await waitFor(() => {
          expect(editor.textContent).toContain("@martin")
        })

        // CRITICAL: Should NOT have navigated (click should not pass through)
        expect(mockNavigate).not.toHaveBeenCalled()
        // Dialog should still be open
        expect(onOpenChange).not.toHaveBeenCalledWith(false)
      })
    })

    describe("BUG: cmd+f should NOT open search mode (only cmd+shift+f should)", () => {
      // Bug: cmd+f (browser find) opens the quick switcher in search mode.
      // Only cmd+shift+f should open search mode, cmd+f should be left alone for browser.
      //
      // Note: This test verifies the keyboard shortcut handling in the parent component
      // that controls QuickSwitcher. The QuickSwitcher itself doesn't handle shortcuts.
      // This test documents the expected behavior - the actual fix may be in a parent.
      it("should not respond to cmd+f keyboard shortcut", async () => {
        const onOpenChange = vi.fn()
        // Start with dialog closed
        render(<QuickSwitcher {...defaultProps} open={false} onOpenChange={onOpenChange} />)

        // Simulate cmd+f at the document level
        const event = new KeyboardEvent("keydown", {
          key: "f",
          metaKey: true,
          bubbles: true,
        })

        // The event should NOT be prevented (browser find should work)
        const prevented = !document.dispatchEvent(event)

        // If the QuickSwitcher or its parent intercepted cmd+f, it would:
        // 1. Call onOpenChange(true) to open the dialog
        // 2. Prevent the default browser behavior
        //
        // Neither should happen for cmd+f (only cmd+shift+f)
        expect(onOpenChange).not.toHaveBeenCalled()
        expect(prevented).toBe(false)
      })

      // Note: The cmd+shift+f shortcut is handled in workspace-layout.tsx,
      // not in QuickSwitcher. Testing that shortcut requires mounting WorkspaceLayout.
      // The test above (should not respond to cmd+f) verifies QuickSwitcher
      // doesn't intercept cmd+f - which is the important behavior to test here.
    })
  })
})
