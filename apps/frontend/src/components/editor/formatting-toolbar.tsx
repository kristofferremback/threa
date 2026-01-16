import type { Editor } from "@tiptap/react"
import { Bold, Italic, Strikethrough, Code, Link2, List, AtSign, Slash, Paperclip } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
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
  onLinkClick,
  onMentionClick,
  onSlashClick,
  onEmojiClick,
  onAttachClick,
}: FormattingToolbarProps) {
  if (!editor) return null

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2">
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
            onLinkClick?.()
          }}
          icon={Link2}
          label="Link"
          isActive={editor.isActive("link")}
          disabled={disabled}
        />
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          icon={List}
          label="Bullet list"
          isActive={editor.isActive("bulletList")}
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
    </TooltipProvider>
  )
}
