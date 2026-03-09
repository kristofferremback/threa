import type { ReactNode } from "react"
import { AtSign, Slash, Paperclip, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { RichEditorHandle } from "./rich-editor"

export interface EditorActionBarProps {
  editorHandle: RichEditorHandle | null
  disabled?: boolean
  // Toggle state
  formatOpen: boolean
  onFormatOpenChange: (open: boolean) => void
  mobileExpanded?: boolean
  onMobileExpandedChange?: (expanded: boolean) => void
  // Optional buttons
  showExpand?: boolean
  showAttach?: boolean
  showSlashCommand?: boolean
  onAttachClick?: () => void
  // Desktop expand (opens fullscreen modal)
  showDesktopExpand?: boolean
  onDesktopExpandClick?: () => void
  // Trailing slot: Send button (composer) or Cancel+Save (edit form)
  trailingContent: ReactNode
}

export function EditorActionBar({
  editorHandle,
  disabled = false,
  formatOpen,
  onFormatOpenChange,
  mobileExpanded = false,
  onMobileExpandedChange,
  showExpand = true,
  showAttach = true,
  showSlashCommand = false,
  onAttachClick,
  showDesktopExpand = false,
  onDesktopExpandClick,
  trailingContent,
}: EditorActionBarProps) {
  return (
    <div className="flex items-center gap-1">
      {/* Spacer — pushes buttons to the right */}
      <span className="flex-1" />

      {/* Expand/collapse toggle — mobile inline expansion */}
      {showExpand && onMobileExpandedChange && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={mobileExpanded ? "Minimize editor" : "Expand editor"}
              aria-pressed={mobileExpanded}
              className="h-7 w-7 shrink-0"
              onPointerDown={(e) => {
                e.preventDefault()
                onMobileExpandedChange(!mobileExpanded)
              }}
              disabled={disabled}
            >
              {mobileExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {mobileExpanded ? "Minimize" : "Expand"}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Desktop expand — opens fullscreen editor modal */}
      {showDesktopExpand && onDesktopExpandClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Expand to fullscreen editor"
              className="h-7 w-7 shrink-0"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onDesktopExpandClick}
              disabled={disabled}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Expand editor
          </TooltipContent>
        </Tooltip>
      )}

      {/* Format toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Formatting"
            aria-pressed={formatOpen}
            className={cn("h-7 w-7 shrink-0", formatOpen && "bg-accent text-accent-foreground")}
            onPointerDown={(e) => {
              e.preventDefault()
              onFormatOpenChange(!formatOpen)
            }}
            disabled={disabled}
          >
            <span className="text-[13px] font-bold leading-none tracking-tight">Aa</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Formatting
        </TooltipContent>
      </Tooltip>

      {/* Insert emoji */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Insert emoji"
            className="h-7 w-7 shrink-0"
            onPointerDown={(e) => {
              e.preventDefault()
              editorHandle?.insertEmoji()
            }}
            disabled={disabled}
          >
            <span className="text-sm leading-none">😊</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Emoji
        </TooltipContent>
      </Tooltip>

      {/* Insert mention */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Insert mention"
            className="h-7 w-7 shrink-0"
            onPointerDown={(e) => {
              e.preventDefault()
              editorHandle?.insertMention()
            }}
            disabled={disabled}
          >
            <AtSign className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Mention
        </TooltipContent>
      </Tooltip>

      {/* Insert slash command */}
      {showSlashCommand && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Insert command"
              className="h-7 w-7 shrink-0"
              onPointerDown={(e) => {
                e.preventDefault()
                editorHandle?.insertSlash()
              }}
              disabled={disabled}
            >
              <Slash className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Command
          </TooltipContent>
        </Tooltip>
      )}

      {/* Attach files */}
      {showAttach && onAttachClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach files"
              className="h-7 w-7 shrink-0"
              onClick={onAttachClick}
              disabled={disabled}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Attach files
          </TooltipContent>
        </Tooltip>
      )}

      {/* Trailing content: Send button (composer) or Cancel+Save (edit form) */}
      {trailingContent}
    </div>
  )
}
