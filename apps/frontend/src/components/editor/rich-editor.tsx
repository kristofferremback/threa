import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { useParams } from "react-router-dom"
import { createEditorExtensions } from "./editor-extensions"
import { EditorBehaviors } from "./editor-behaviors"
import { serializeToMarkdown, parseMarkdown, type MentionTypeLookup } from "./editor-markdown"
import { EditorToolbar } from "./editor-toolbar"
import { useMentionSuggestion, useChannelSuggestion, useCommandSuggestion, useEmojiSuggestion } from "./triggers"
import { useMentionables } from "@/hooks/use-mentionables"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { cn } from "@/lib/utils"
import type { UploadResult } from "@/hooks/use-attachments"
import type { AttachmentReferenceAttrs } from "./attachment-reference-extension"

interface RichEditorProps {
  value: string
  onChange: (markdown: string) => void
  onSubmit: () => void
  /** Called when files are pasted or dropped. Returns upload result for updating the node. */
  onFileUpload?: (file: File) => Promise<UploadResult>
  /** Current count of images for sequential naming of pasted images */
  imageCount?: number
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function RichEditor({
  value,
  onChange,
  onSubmit,
  onFileUpload,
  imageCount = 0,
  placeholder = "Type a message...",
  disabled = false,
  className,
}: RichEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [showLinkHint, setShowLinkHint] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linkHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, forceUpdate] = useState(0)
  const isInternalUpdate = useRef(false)

  // Mention, channel, command, and emoji autocomplete
  const { mentionables } = useMentionables()
  const { suggestionConfig: mentionConfig, renderMentionList } = useMentionSuggestion()
  const { suggestionConfig: channelConfig, renderChannelList } = useChannelSuggestion()
  const { suggestionConfig: commandConfig, renderCommandList } = useCommandSuggestion()

  // Emoji autocomplete
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { emojis, emojiWeights, toEmoji } = useWorkspaceEmoji(workspaceId ?? "")
  const { suggestionConfig: emojiConfig, renderEmojiGrid } = useEmojiSuggestion({ emojis, emojiWeights })

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
  const toEmojiRef = useRef(toEmoji)
  toEmojiRef.current = toEmoji

  // Ref to avoid stale closure for file upload callback
  const onFileUploadRef = useRef(onFileUpload)
  onFileUploadRef.current = onFileUpload

  // Ref to access current image count for paste renaming
  const imageCountRef = useRef(imageCount)
  imageCountRef.current = imageCount

  // Ref to access editor instance from callbacks defined before useEditor returns
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Track mentionables state to detect when data loads or currentUser becomes known
  const lastParsedState = useRef({ count: mentionables.length, hasCurrentUser: false })
  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        placeholder,
        mentionSuggestion: mentionConfig,
        channelSuggestion: channelConfig,
        commandSuggestion: commandConfig,
        emojiSuggestion: emojiConfig,
        toEmoji,
      }),
      EditorBehaviors,
    ],
    [placeholder, mentionConfig, channelConfig, commandConfig, emojiConfig, toEmoji]
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

  // Helper to handle file insertion from paste or drop
  const handleFileInsert = useCallback(async (file: File, editorInstance: ReturnType<typeof useEditor>) => {
    const uploadFn = onFileUploadRef.current
    if (!uploadFn || !editorInstance) return

    const isImage = file.type.startsWith("image/")
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`

    // Insert placeholder node
    const placeholderAttrs: AttachmentReferenceAttrs = {
      id: tempId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      status: "uploading",
      imageIndex: null, // Will be set after upload
      error: null,
    }

    editorInstance.commands.insertAttachmentReference(placeholderAttrs)

    // Start upload and update node when done
    const result = await uploadFn(file)

    // Update the placeholder node with real data
    editorInstance.commands.updateAttachmentReference(tempId, {
      id: result.attachment.id,
      status: result.attachment.status,
      imageIndex: isImage ? result.imageIndex : null,
      error: result.attachment.error || null,
    })
  }, [])

  const editor = useEditor({
    extensions,
    content: parseMarkdown(value, getMentionType, toEmoji),
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
        // Check for files first (images, documents, etc.)
        const files = event.clipboardData?.files
        if (files && files.length > 0 && onFileUploadRef.current && editorRef.current) {
          event.preventDefault()
          const fileArray = Array.from(files)
          let pasteImageOffset = 0
          for (const file of fileArray) {
            let fileToInsert = file
            // Rename pasted images to sequential names (pasted-image-1.png, etc.)
            if (file.type.startsWith("image/")) {
              pasteImageOffset++
              const nextIndex = imageCountRef.current + pasteImageOffset
              const ext = file.name.split(".").pop() || "png"
              const newName = `pasted-image-${nextIndex}.${ext}`
              fileToInsert = new File([file], newName, { type: file.type })
            }
            handleFileInsert(fileToInsert, editorRef.current)
          }
          return true
        }

        // Parse pasted text through markdown parser to convert @mentions, #channels, :emoji:
        const text = event.clipboardData?.getData("text/plain")
        if (text) {
          event.preventDefault()
          const parsed = parseMarkdown(text, getMentionTypeRef.current, toEmojiRef.current)
          editorRef.current?.commands.insertContent(parsed)
          return true
        }
        return false
      },
      handleDrop: (_view, event, _slice, moved) => {
        // Internal drag-and-drop (reordering) - let TipTap handle it
        if (moved) return false

        // Check for dropped files
        const files = event.dataTransfer?.files
        if (files && files.length > 0 && onFileUploadRef.current && editorRef.current) {
          event.preventDefault()
          for (const file of Array.from(files)) {
            handleFileInsert(file, editorRef.current)
          }
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
        // Shift+Cmd/Ctrl+V to paste as plain text (no mention parsing)
        if (event.key === "v" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          navigator.clipboard
            .readText()
            .then((text) => {
              editorRef.current?.commands.insertContent(text)
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

  // Store editor in ref so callbacks defined inside useEditor options can access it
  editorRef.current = editor

  // Sync external value changes (e.g., draft restoration, clearing after send)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const currentMarkdown = serializeToMarkdown(editor.getJSON())
    if (value !== currentMarkdown) {
      isInternalUpdate.current = true
      editor.commands.setContent(parseMarkdown(value, getMentionType, toEmoji))
      isInternalUpdate.current = false
    }
  }, [value, editor, getMentionType, toEmoji])

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
        editor.commands.setContent(parseMarkdown(markdown, getMentionType, toEmoji))
        isInternalUpdate.current = false
      }
    }
  }, [editor, mentionables, getMentionType, toEmoji])

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

  // Show hint when user presses Cmd+K with text selected (former link shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === "k" && !e.shiftKey) {
        // Check if editor has text selected and focus is within editor container
        const focusInEditor = containerRef.current?.contains(document.activeElement)
        if (editor && !editor.state.selection.empty && focusInEditor) {
          // Clear any existing timeout
          if (linkHintTimeoutRef.current) {
            clearTimeout(linkHintTimeoutRef.current)
          }
          setShowLinkHint(true)
          linkHintTimeoutRef.current = setTimeout(() => {
            setShowLinkHint(false)
          }, 4000)
        }
      }
    }

    // Use capture phase to detect before the global quick switcher handler
    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      if (linkHintTimeoutRef.current) {
        clearTimeout(linkHintTimeoutRef.current)
      }
    }
  }, [editor])

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
        {showLinkHint && (
          <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-50 px-3 py-2 text-xs font-medium bg-popover text-popover-foreground border rounded-md shadow-md animate-in fade-in slide-in-from-bottom-2 duration-200">
            Trying to add a link? Paste a URL or use the toolbar.
          </div>
        )}
      </div>
      {renderMentionList()}
      {renderChannelList()}
      {renderCommandList()}
      {renderEmojiGrid()}
    </div>
  )
}
