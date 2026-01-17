import { useState, useRef, useEffect, useCallback } from "react"
import type { Editor } from "@tiptap/react"
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link2,
  List,
  ListOrdered,
  Quote,
  Braces,
  AtSign,
  Slash,
  Paperclip,
  X,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface FormattingToolbarProps {
  editor: Editor | null
  disabled?: boolean
  onLinkClick?: () => void
  /** Insert @ to trigger mention popup */
  onMentionClick?: () => void
  /** Insert / to trigger command popup */
  onSlashClick?: () => void
  /** Insert : to trigger emoji popup */
  onEmojiClick?: () => void
  /** Open file picker for attachments */
  onAttachClick?: () => void
  /** Control link popover visibility externally */
  linkPopoverOpen?: boolean
  onLinkPopoverOpenChange?: (open: boolean) => void
}

interface ToolbarBtnProps {
  onClick: () => void
  icon?: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  isActive?: boolean
  disabled?: boolean
  children?: React.ReactNode
}

function ToolbarBtn({ onClick, icon: Icon, label, shortcut, isActive, disabled, children }: ToolbarBtnProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!disabled) onClick()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={handleMouseDown}
          disabled={disabled}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150",
            "text-foreground hover:bg-muted",
            isActive && "bg-primary/15 text-primary",
            disabled && "cursor-not-allowed opacity-50"
          )}
          aria-label={label}
          aria-pressed={isActive}
        >
          {Icon && <Icon className="h-4 w-4" />}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          {shortcut && <span className="text-muted-foreground">{shortcut}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-border" />
}

export function FormattingToolbar({
  editor,
  disabled,
  onMentionClick,
  onSlashClick,
  onEmojiClick,
  onAttachClick,
  linkPopoverOpen,
  onLinkPopoverOpenChange,
}: FormattingToolbarProps) {
  if (!editor) return null

  const isLinkActive = editor.isActive("link")

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col">
        <div className="flex items-center gap-1 border-b border-border/50 py-2 mb-2">
          {/* Text formatting */}
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBold().run()}
            icon={Bold}
            label="Bold"
            shortcut="⌘B"
            isActive={editor.isActive("bold")}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleItalic().run()}
            icon={Italic}
            label="Italic"
            shortcut="⌘I"
            isActive={editor.isActive("italic")}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleStrike().run()}
            icon={Strikethrough}
            label="Strikethrough"
            shortcut="⌘⇧S"
            isActive={editor.isActive("strike")}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleCode().run()}
            icon={Code}
            label="Inline code"
            shortcut="⌘E"
            isActive={editor.isActive("code")}
            disabled={disabled}
          />

          <ToolbarDivider />

          {/* Structural formatting */}
          <ToolbarBtn
            onClick={() => {
              const isClosing = !!linkPopoverOpen
              onLinkPopoverOpenChange?.(!linkPopoverOpen)
              if (isClosing) {
                editor.commands.focus()
              }
            }}
            icon={Link2}
            label="Link"
            isActive={isLinkActive || !!linkPopoverOpen}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            icon={Quote}
            label="Quote"
            isActive={editor.isActive("blockquote")}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            icon={List}
            label="Bullet list"
            isActive={editor.isActive("bulletList")}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            icon={ListOrdered}
            label="Numbered list"
            isActive={editor.isActive("orderedList")}
            disabled={disabled}
          />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            icon={Braces}
            label="Code block"
            shortcut="⌘⇧C"
            isActive={editor.isActive("codeBlock")}
            disabled={disabled}
          />

          <ToolbarDivider />

          {/* Special insertions */}
          <ToolbarBtn onClick={() => onEmojiClick?.()} label="Emoji" disabled={disabled}>
            <span className="text-sm">😊</span>
          </ToolbarBtn>
          <ToolbarBtn onClick={() => onMentionClick?.()} icon={AtSign} label="Mention" disabled={disabled} />
          <ToolbarBtn onClick={() => onSlashClick?.()} icon={Slash} label="Command" disabled={disabled} />
          <ToolbarBtn onClick={() => onAttachClick?.()} icon={Paperclip} label="Attach files" disabled={disabled} />
        </div>

        {/* Link editor - inline below toolbar when open */}
        {linkPopoverOpen && (
          <LinkEditor
            editor={editor}
            isActive={isLinkActive}
            onClose={() => {
              onLinkPopoverOpenChange?.(false)
              editor.commands.focus()
            }}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

interface LinkEditorProps {
  editor: Editor
  isActive: boolean
  onClose: () => void
}

function LinkEditor({ editor, isActive, onClose }: LinkEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const currentUrl = editor.getAttributes("link").href || ""
  const [url, setUrl] = useState(currentUrl)

  useEffect(() => {
    setUrl(currentUrl)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [currentUrl])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
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
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    onClose()
  }, [editor, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        editor.commands.focus()
      }
    },
    [onClose, editor]
  )

  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 bg-muted/20">
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
      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={onClose}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
