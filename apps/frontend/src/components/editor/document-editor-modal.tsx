import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useEditor, EditorContent, useEditorState } from "@tiptap/react"
import { useParams } from "react-router-dom"
import {
  Bold,
  Italic,
  Strikethrough,
  Link2,
  Quote,
  Code,
  Braces,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { createEditorExtensions } from "./editor-extensions"
import { EditorBehaviors, handleLinkToolbarAction, isSuggestionActive } from "./editor-behaviors"
import { serializeToMarkdown, parseMarkdown, type MentionTypeLookup } from "./editor-markdown"
import { useMentionSuggestion, useChannelSuggestion, useEmojiSuggestion } from "./triggers"
import { useMentionables } from "@/hooks/use-mentionables"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { LinkEditor } from "./link-editor"
import { handleBeforeInputNewline, insertPastedText, toggleMultilineBlock } from "./multiline-blocks"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts"
import { getEffectiveEditorBindings, formatKeyBinding } from "@/lib/keyboard-shortcuts"

interface DocumentEditorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialContent?: string
  onSend: (content: string) => void
  /** Called when modal is dismissed (Cancel, Escape, click outside) - returns current content for sync */
  onDismiss?: (content: string) => void
  streamName: string
}

export function DocumentEditorModal({
  open,
  onOpenChange,
  initialContent = "",
  onSend,
  onDismiss,
  streamName,
}: DocumentEditorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInternalUpdate = useRef(false)
  const wasOpenRef = useRef(false)
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)

  // Mention, channel, and emoji autocomplete
  const { mentionables } = useMentionables()
  const { suggestionConfig: mentionConfig, renderMentionList } = useMentionSuggestion()
  const { suggestionConfig: channelConfig, renderChannelList } = useChannelSuggestion()

  // Emoji autocomplete
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { emojis, emojiWeights, toEmoji } = useWorkspaceEmoji(workspaceId ?? "")
  const { suggestionConfig: emojiConfig, renderEmojiGrid } = useEmojiSuggestion({ emojis, emojiWeights })

  // Create lookup for mention types from mentionables
  const getMentionType = useMemo<MentionTypeLookup>(() => {
    const slugToType = new Map<string, "user" | "persona" | "bot" | "broadcast" | "me">()
    for (const m of mentionables) {
      slugToType.set(m.slug, m.isCurrentUser ? "me" : m.type)
    }
    return (slug: string) => slugToType.get(slug) ?? "user"
  }, [mentionables])

  const initContentRef = useRef(initialContent)
  const getMentionTypeRef = useRef(getMentionType)
  const toEmojiRef = useRef(toEmoji)
  initContentRef.current = initialContent
  getMentionTypeRef.current = getMentionType
  toEmojiRef.current = toEmoji

  // Ref for handleSubmit without re-creating extensions
  const handleSubmitRef = useRef(() => {})
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Effective editor formatting bindings (updated reactively via ref)
  const { preferences } = usePreferences()
  const docCustomBindings = preferences?.keyboardShortcuts ?? {}
  const effectiveDocBindings = useMemo(() => getEffectiveEditorBindings(docCustomBindings), [docCustomBindings])
  const keyBindingsRef = useRef<Record<string, string>>({})
  keyBindingsRef.current = effectiveDocBindings
  const docShortcutHint = useCallback(
    (actionId: string): string | undefined => {
      const binding = effectiveDocBindings[actionId]
      return binding ? formatKeyBinding(binding) : undefined
    },
    [effectiveDocBindings]
  )

  // Create extensions (no cmdEnter handling - explicit Send button only)
  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        placeholder: "Write your message...",
        mentionSuggestion: mentionConfig,
        channelSuggestion: channelConfig,
        emojiSuggestion: emojiConfig,
        toEmoji,
      }),
      EditorBehaviors.configure({
        sendModeRef: { current: "cmdEnter" }, // Use cmdEnter mode in modal
        onSubmitRef: handleSubmitRef,
        keyBindingsRef: keyBindingsRef,
      }),
    ],
    [mentionConfig, channelConfig, emojiConfig, toEmoji]
  )

  const editor = useEditor({
    extensions,
    content: parseMarkdown(initialContent, getMentionType, toEmoji),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[300px] max-h-[60vh] overflow-y-auto w-full px-4 py-3 outline-none",
          "prose prose-sm dark:prose-invert max-w-none",
          "[&_p]:my-0 [&_p]:min-h-[1.5em]",
          "[&_ul]:my-1 [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:pl-5",
          "[&_li]:my-0 [&_li]:pl-0.5",
          "[&_pre]:my-2 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic",
          "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2",
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5",
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1",
          "focus:outline-none"
        ),
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain")
        if (!text || !editorRef.current) {
          return false
        }

        const handled = insertPastedText(editorRef.current, text, getMentionTypeRef.current, toEmojiRef.current)
        if (handled) {
          event.preventDefault()
        }

        return handled
      },
      handleDOMEvents: {
        beforeinput: (_view, event) => {
          if (!editorRef.current || isSuggestionActive(editorRef.current)) {
            return false
          }

          return handleBeforeInputNewline(editorRef.current, event as InputEvent)
        },
      },
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl+Enter: send
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
          event.preventDefault()
          handleSubmitRef.current()
          return true
        }
        return false
      },
    },
  })

  // Store editor ref for accessing inside callbacks
  editorRef.current = editor

  // Handle send
  const handleSubmit = useCallback(() => {
    if (!editorRef.current) return
    const markdown = serializeToMarkdown(editorRef.current.getJSON())
    if (markdown.trim()) {
      onSend(markdown)
      onOpenChange(false)
    }
  }, [onSend, onOpenChange])

  // Handle dismiss (sync content back to parent)
  const handleDismiss = useCallback(() => {
    if (editorRef.current && onDismiss) {
      const markdown = serializeToMarkdown(editorRef.current.getJSON())
      onDismiss(markdown)
    }
    onOpenChange(false)
  }, [onDismiss, onOpenChange])

  // Update submit ref for keyboard shortcut
  handleSubmitRef.current = handleSubmit

  // Reset content only when dialog transitions from closed to open
  useEffect(() => {
    const isNewlyOpened = open && !wasOpenRef.current
    wasOpenRef.current = open

    if (isNewlyOpened && editor && !editor.isDestroyed) {
      isInternalUpdate.current = true
      editor.commands.setContent(parseMarkdown(initContentRef.current, getMentionTypeRef.current, toEmojiRef.current))
      isInternalUpdate.current = false
      editor.commands.focus("end")
    }
  }, [open, editor])

  // Reactively check if content is empty (TipTap v3 requires useEditorState for reactive reads)
  const isEmpty = useEditorState({
    editor,
    selector: (ctx) => !ctx.editor || ctx.editor.isEmpty,
  })

  // Handle dialog close events (escape, click outside) - sync content
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        handleDismiss()
      } else {
        onOpenChange(true)
      }
    },
    [handleDismiss, onOpenChange]
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="w-[90vw] max-w-[800px] h-[80vh] max-h-[700px] sm:flex flex-col gap-0 p-0"
        drawerClassName="flex flex-col gap-0 p-0"
        hideCloseButton
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking on suggestion popover
          const target = e.target as HTMLElement
          if (target.closest('[role="listbox"]')) {
            e.preventDefault()
          }
        }}
      >
        {/* Header */}
        <ResponsiveDialogHeader className="px-4 py-3 border-b">
          <ResponsiveDialogTitle className="text-base font-medium">
            Message in <span className="text-primary">{streamName}</span>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {/* Toolbar - fixed position, not floating */}
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5 px-4 py-2 border-b bg-muted/30 overflow-x-auto">
            {/* Heading buttons */}
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              icon={Heading1}
              label="Heading 1"
              isActive={editor?.isActive("heading", { level: 1 })}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              icon={Heading2}
              label="Heading 2"
              isActive={editor?.isActive("heading", { level: 2 })}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
              icon={Heading3}
              label="Heading 3"
              isActive={editor?.isActive("heading", { level: 3 })}
            />

            <Separator orientation="vertical" className="mx-1 h-6" />

            {/* Inline formatting */}
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleBold().run()}
              icon={Bold}
              label="Bold"
              shortcut={docShortcutHint("formatBold")}
              isActive={editor?.isActive("bold")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleItalic().run()}
              icon={Italic}
              label="Italic"
              shortcut={docShortcutHint("formatItalic")}
              isActive={editor?.isActive("italic")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleStrike().run()}
              icon={Strikethrough}
              label="Strikethrough"
              shortcut={docShortcutHint("formatStrike")}
              isActive={editor?.isActive("strike")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleCode().run()}
              icon={Code}
              label="Inline code"
              shortcut={docShortcutHint("formatCode")}
              isActive={editor?.isActive("code")}
            />
            <ToolbarButton
              onAction={() => editor && handleLinkToolbarAction(editor, linkEditorOpen, setLinkEditorOpen)}
              icon={Link2}
              label="Link"
              isActive={editor?.isActive("link") || linkEditorOpen}
            />

            <Separator orientation="vertical" className="mx-1 h-6" />

            {/* Block formatting */}
            <ToolbarButton
              onAction={() => editor && toggleMultilineBlock(editor, "blockquote")}
              icon={Quote}
              label="Quote"
              isActive={editor?.isActive("blockquote")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleBulletList().run()}
              icon={List}
              label="Bullet list"
              isActive={editor?.isActive("bulletList")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleOrderedList().run()}
              icon={ListOrdered}
              label="Numbered list"
              isActive={editor?.isActive("orderedList")}
            />
            <ToolbarButton
              onAction={() => editor && toggleMultilineBlock(editor, "codeBlock")}
              icon={Braces}
              label="Code block"
              shortcut={docShortcutHint("formatCodeBlock")}
              isActive={editor?.isActive("codeBlock")}
            />
          </div>

          {/* Link editor - inline below toolbar when open */}
          {linkEditorOpen && editor && (
            <LinkEditor
              editor={editor}
              isActive={editor.isActive("link")}
              onClose={() => {
                setLinkEditorOpen(false)
                editor.commands.focus()
              }}
            />
          )}
        </TooltipProvider>

        {/* Editor body */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden cursor-text"
          onClick={() => editor?.commands.focus("end")}
        >
          <EditorContent editor={editor} className="h-full" />
          {renderMentionList()}
          {renderChannelList()}
          {renderEmojiGrid()}
        </div>

        {/* Footer */}
        <ResponsiveDialogFooter className="px-4 py-3 border-t flex-row items-center">
          <span className="hidden sm:inline text-xs text-muted-foreground">
            <kbd className="kbd-hint">{navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}↵</kbd> to send
          </span>
          <div className="flex gap-2 sm:ml-auto w-full sm:w-auto justify-end">
            <Button variant="ghost" onClick={handleDismiss}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isEmpty} className="flex-1 sm:flex-initial">
              Send
            </Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

interface ToolbarButtonProps {
  onAction: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  isActive?: boolean
}

function ToolbarButton({ onAction, icon: Icon, label, shortcut, isActive }: ToolbarButtonProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    onAction()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onMouseDown={handleMouseDown}
          className={cn("h-8 w-8 p-0 hover:bg-muted", isActive && "bg-muted-foreground/20 text-foreground")}
          tabIndex={-1}
          aria-label={label}
          aria-pressed={isActive}
        >
          <Icon className={cn("h-4 w-4", isActive && "stroke-[2.5px]")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          {shortcut && <span className="text-muted-foreground">{shortcut}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
