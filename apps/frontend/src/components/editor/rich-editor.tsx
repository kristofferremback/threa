import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { useParams } from "react-router-dom"
import { createEditorExtensions } from "./editor-extensions"
import { EditorBehaviors, isSuggestionActive } from "./editor-behaviors"
import { EditorToolbar } from "./editor-toolbar"
import { serializeToMarkdown, parseMarkdown, type MentionTypeLookup } from "./editor-markdown"
import { useMentionSuggestion, useChannelSuggestion, useCommandSuggestion, useEmojiSuggestion } from "./triggers"
import { useMentionables } from "@/hooks/use-mentionables"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { cn } from "@/lib/utils"
import type { UploadResult } from "@/hooks/use-attachments"
import type { AttachmentReferenceAttrs } from "./attachment-reference-extension"
import type { MessageSendMode } from "@threa/types"

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
  /** How Enter key behaves: "enter" = Enter sends, "cmdEnter" = Cmd+Enter sends */
  messageSendMode?: MessageSendMode
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
  messageSendMode = "enter",
}: RichEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInternalUpdate = useRef(false)
  const [isFocused, setIsFocused] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Refs for editor behaviors to avoid stale closures in keyboard shortcuts
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const messageSendModeRef = useRef(messageSendMode)
  messageSendModeRef.current = messageSendMode

  // Ref to access editor instance from callbacks defined before useEditor returns
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Track mentionables state to detect when data loads or currentUser becomes known
  const lastParsedState = useRef({ count: mentionables.length, hasCurrentUser: false })
  // Extensions are memoized but DON'T depend on messageSendMode/onSubmit
  // because we pass refs that get updated on render
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
      EditorBehaviors.configure({
        sendModeRef: messageSendModeRef,
        onSubmitRef: onSubmitRef,
      }),
    ],
    [placeholder, mentionConfig, channelConfig, commandConfig, emojiConfig, toEmoji]
  )

  // Debounced toolbar visibility - stays visible briefly after focus lost
  const shouldBeVisible = isFocused || linkPopoverOpen
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
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[80px] w-full px-3 py-2 outline-none",
          "prose prose-sm dark:prose-invert max-w-none",
          // Paragraph styling - minimal spacing for chat-like feel
          "[&_p]:my-0 [&_p]:min-h-[1.5em]",
          // List styling
          "[&_ul]:my-1 [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:pl-5",
          "[&_li]:my-0 [&_li]:pl-0.5",
          // Code block styling
          "[&_pre]:my-2 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
          // Inline code styling
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5",
          "[&_code]:before:content-none [&_code]:after:content-none",
          // Blockquote styling
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic",
          // Heading styling
          "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2",
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5",
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1",
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
        // Cmd/Ctrl+Enter: always send (regardless of mode or active suggestions)
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
          event.preventDefault()
          onSubmitRef.current()
          return true
        }
        // Enter in "enter" send mode: send unless a suggestion popup is active
        if (event.key === "Enter" && !event.shiftKey && messageSendModeRef.current === "enter") {
          if (editorRef.current && isSuggestionActive(editorRef.current)) {
            return false // Let suggestion popup handle Enter
          }
          event.preventDefault()
          onSubmitRef.current()
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

  // Copy handler: serialize selection to markdown
  useEffect(() => {
    if (!editor || !containerRef.current) return

    const handleCopy = (event: ClipboardEvent) => {
      const { from, to } = editor.state.selection
      if (from === to) return // No selection, use default behavior

      const slice = editor.state.doc.slice(from, to)
      const json = { type: "doc", content: slice.content.toJSON() }
      const markdown = serializeToMarkdown(json)

      event.clipboardData?.setData("text/plain", markdown)
      event.preventDefault()
    }

    const container = containerRef.current
    container.addEventListener("copy", handleCopy)
    return () => container.removeEventListener("copy", handleCopy)
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
      {renderEmojiGrid()}
    </div>
  )
}
