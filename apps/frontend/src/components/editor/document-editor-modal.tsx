import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
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
  X,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { createEditorExtensions } from "./editor-extensions"
import { EditorBehaviors } from "./editor-behaviors"
import { serializeToMarkdown, parseMarkdown, type MentionTypeLookup } from "./editor-markdown"
import { useMentionSuggestion, useChannelSuggestion, useEmojiSuggestion } from "./triggers"
import { useMentionables } from "@/hooks/use-mentionables"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { cn } from "@/lib/utils"

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
    const slugToType = new Map<string, "user" | "persona" | "broadcast" | "me">()
    for (const m of mentionables) {
      slugToType.set(m.slug, m.isCurrentUser ? "me" : m.type)
    }
    return (slug: string) => slugToType.get(slug) ?? "user"
  }, [mentionables])

  // Ref for handleSubmit without re-creating extensions
  const handleSubmitRef = useRef(() => {})

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
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5",
          "[&_code]:before:content-none [&_code]:after:content-none",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic",
          "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2",
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5",
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1",
          "focus:outline-none"
        ),
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
  const editorRef = useRef(editor)
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

  // Reset content when dialog opens with new initial content
  useEffect(() => {
    if (open && editor && !editor.isDestroyed) {
      isInternalUpdate.current = true
      editor.commands.setContent(parseMarkdown(initialContent, getMentionType, toEmoji))
      isInternalUpdate.current = false
      editor.commands.focus("end")
    }
  }, [open, initialContent, editor, getMentionType, toEmoji])

  // Check if content is empty
  const isEmpty = !editor || editor.isEmpty

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-[800px] h-[80vh] max-h-[700px] flex flex-col gap-0 p-0"
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking on suggestion popover
          const target = e.target as HTMLElement
          if (target.closest('[role="listbox"]')) {
            e.preventDefault()
          }
        }}
      >
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base font-medium">
            Message in <span className="text-primary">{streamName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar - fixed position, not floating */}
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5 px-4 py-2 border-b bg-muted/30">
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
              shortcut="⌘B"
              isActive={editor?.isActive("bold")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleItalic().run()}
              icon={Italic}
              label="Italic"
              shortcut="⌘I"
              isActive={editor?.isActive("italic")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleStrike().run()}
              icon={Strikethrough}
              label="Strikethrough"
              shortcut="⌘⇧S"
              isActive={editor?.isActive("strike")}
            />
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleCode().run()}
              icon={Code}
              label="Inline code"
              shortcut="⌘E"
              isActive={editor?.isActive("code")}
            />
            <ToolbarButton
              onAction={() => setLinkEditorOpen(!linkEditorOpen)}
              icon={Link2}
              label="Link"
              isActive={editor?.isActive("link") || linkEditorOpen}
            />

            <Separator orientation="vertical" className="mx-1 h-6" />

            {/* Block formatting */}
            <ToolbarButton
              onAction={() => editor?.chain().focus().toggleBlockquote().run()}
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
              onAction={() => editor?.chain().focus().toggleCodeBlock().run()}
              icon={Braces}
              label="Code block"
              shortcut="⌘⇧C"
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
        <DialogFooter className="px-4 py-3 border-t">
          <div className="flex items-center gap-3 w-full justify-between">
            <span className="text-xs text-muted-foreground">
              <kbd className="kbd-hint">{navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}↵</kbd> to send
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleDismiss}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isEmpty}>
                Send
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

interface LinkEditorProps {
  editor: ReturnType<typeof useEditor>
  isActive: boolean
  onClose: () => void
}

function LinkEditor({ editor, isActive, onClose }: LinkEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const currentUrl = editor?.getAttributes("link").href || ""
  const [url, setUrl] = useState(currentUrl)

  useEffect(() => {
    setUrl(currentUrl)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [currentUrl])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!editor) return
      if (url.trim()) {
        const finalUrl = url.startsWith("http") ? url : `https://${url}`
        editor.chain().focus().extendMarkRange("link").setLink({ href: finalUrl }).run()
      } else {
        editor.chain().focus().extendMarkRange("link").unsetLink().run()
      }
      onClose()
    },
    [editor, url, onClose]
  )

  const handleRemoveLink = useCallback(() => {
    if (!editor) return
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    onClose()
  }, [editor, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        editor?.commands.focus()
      }
    },
    [onClose, editor]
  )

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20">
      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-2">
        <Input
          ref={inputRef}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-7 flex-1 text-sm"
        />
        <Button type="submit" size="sm" className="h-7 px-3">
          {isActive ? "Update" : "Add"}
        </Button>
        {isActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-destructive hover:text-destructive"
            onClick={handleRemoveLink}
          >
            Remove
          </Button>
        )}
      </form>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0"
        onClick={() => {
          onClose()
          editor?.commands.focus()
        }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
