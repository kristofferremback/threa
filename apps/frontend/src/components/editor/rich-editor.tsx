import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { createEditorExtensions } from "./editor-extensions"
import { EditorBehaviors } from "./editor-behaviors"
import { serializeToMarkdown, parseMarkdown, type MentionTypeLookup } from "./editor-markdown"
import { EditorToolbar } from "./editor-toolbar"
import { useMentionSuggestion, useChannelSuggestion, useCommandSuggestion } from "./triggers"
import { useMentionables } from "@/hooks/use-mentionables"
import { cn } from "@/lib/utils"

interface RichEditorProps {
  value: string
  onChange: (markdown: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function RichEditor({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  disabled = false,
  className,
}: RichEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, forceUpdate] = useState(0)
  const isInternalUpdate = useRef(false)

  // Mention, channel, and command autocomplete
  const { mentionables } = useMentionables()
  const { suggestionConfig: mentionConfig, renderMentionList } = useMentionSuggestion()
  const { suggestionConfig: channelConfig, renderChannelList } = useChannelSuggestion()
  const { suggestionConfig: commandConfig, renderCommandList } = useCommandSuggestion()

  // Create lookup for mention types from mentionables
  // Current user's slug maps to "me" for special highlighting
  const getMentionType = useMemo<MentionTypeLookup>(() => {
    const slugToType = new Map<string, "user" | "persona" | "broadcast" | "me">()
    for (const m of mentionables) {
      // Map current user to "me" type for special highlighting
      slugToType.set(m.slug, m.isCurrentUser ? "me" : m.type)
    }
    return (slug: string) => slugToType.get(slug) ?? "user"
  }, [mentionables])

  // Ref to avoid stale closure in TipTap paste handler
  const getMentionTypeRef = useRef(getMentionType)
  getMentionTypeRef.current = getMentionType

  // Track mentionables state to detect when data loads or currentUser becomes known
  const lastParsedState = useRef({ count: mentionables.length, hasCurrentUser: false })
  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        placeholder,
        mentionSuggestion: mentionConfig,
        channelSuggestion: channelConfig,
        commandSuggestion: commandConfig,
      }),
      EditorBehaviors,
    ],
    [placeholder, mentionConfig, channelConfig, commandConfig]
  )

  // Debounced toolbar visibility - stays visible 150ms after conditions become false
  const shouldBeVisible = isFocused || linkPopoverOpen || dropdownOpen
  useEffect(() => {
    if (shouldBeVisible) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
      setToolbarVisible(true)
    } else {
      hideTimeoutRef.current = setTimeout(() => {
        setToolbarVisible(false)
      }, 150)
    }
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [shouldBeVisible])

  const editor = useEditor({
    extensions,
    content: parseMarkdown(value, getMentionType),
    editable: !disabled,
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      const markdown = serializeToMarkdown(editor.getJSON())
      onChange(markdown)
    },
    onTransaction: () => {
      // Force re-render on any transaction to update toolbar button states immediately
      // This includes formatting toggles (Cmd+B), selection changes, content changes
      forceUpdate((n) => n + 1)
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[80px] w-full px-3 py-2 outline-none",
          "prose prose-sm dark:prose-invert max-w-none",
          "focus:outline-none"
        ),
      },
      handlePaste: (_view, event) => {
        // Parse pasted text through markdown parser to convert @mentions, #channels
        const text = event.clipboardData?.getData("text/plain")
        if (text) {
          event.preventDefault()
          const parsed = parseMarkdown(text, getMentionTypeRef.current)
          editor?.commands.insertContent(parsed)
          return true
        }
        return false
      },
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl+Enter to submit
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSubmit()
          return true
        }
        // Cmd/Ctrl+K to open link popover
        if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          setLinkPopoverOpen(true)
          return true
        }
        // Shift+Cmd/Ctrl+V to paste as plain text (no mention parsing)
        if (event.key === "v" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          navigator.clipboard
            .readText()
            .then((text) => {
              editor?.commands.insertContent(text)
            })
            .catch(() => {
              // Clipboard access denied or unavailable - silently fail
            })
          return true
        }
        return false
      },
    },
  })

  // Sync external value changes (e.g., draft restoration, clearing after send)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const currentMarkdown = serializeToMarkdown(editor.getJSON())
    if (value !== currentMarkdown) {
      isInternalUpdate.current = true
      editor.commands.setContent(parseMarkdown(value, getMentionType))
      isInternalUpdate.current = false
    }
  }, [value, editor, getMentionType])

  // Re-parse content when mentionables load or currentUser becomes known (for correct mention type colors)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const hasCurrentUser = mentionables.some((m) => m.isCurrentUser)
    const current = { count: mentionables.length, hasCurrentUser }

    // Re-parse if:
    // 1. More mentionables loaded than last time, OR
    // 2. We now have current user info but didn't before
    const shouldReparse =
      current.count > lastParsedState.current.count ||
      (current.hasCurrentUser && !lastParsedState.current.hasCurrentUser)

    if (shouldReparse) {
      lastParsedState.current = current
      const markdown = serializeToMarkdown(editor.getJSON())
      if (markdown) {
        isInternalUpdate.current = true
        editor.commands.setContent(parseMarkdown(markdown, getMentionType))
        isInternalUpdate.current = false
      }
    }
  }, [editor, mentionables, getMentionType])

  // Focus editor on mount
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.focus("end")
    }
  }, [editor])

  // Expose focus method
  const focus = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.focus("end")
    }
  }, [editor])

  // Re-focus after disabled changes (e.g., after sending)
  useEffect(() => {
    if (!disabled && editor && !editor.isDestroyed) {
      // Small delay to ensure editor is re-enabled
      const timer = setTimeout(() => focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [disabled, editor, focus])

  return (
    <div ref={containerRef} className="relative flex-1">
      <EditorToolbar
        editor={editor}
        isVisible={toolbarVisible}
        referenceElement={containerRef.current}
        linkPopoverOpen={linkPopoverOpen}
        onLinkPopoverOpenChange={setLinkPopoverOpen}
        onDropdownOpenChange={setDropdownOpen}
      />
      <div
        className={cn(
          "rounded-md border border-input bg-background",
          "ring-offset-background transition-colors",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        <EditorContent editor={editor} />
      </div>
      {renderMentionList()}
      {renderChannelList()}
      {renderCommandList()}
    </div>
  )
}
