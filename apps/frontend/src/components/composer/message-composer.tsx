import { type ChangeEvent, type RefObject, useMemo, useCallback, useRef, useState, useEffect } from "react"
import { AtSign, Slash, Paperclip, ArrowUp } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { RichEditor } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import { cn } from "@/lib/utils"
import type { PendingAttachment, UploadResult } from "@/hooks/use-attachments"
import type { MessageSendMode, JSONContent } from "@threa/types"

/** Platform-appropriate modifier key symbol (⌘ on Mac, Ctrl+ elsewhere) */
const MOD_SYMBOL = navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"

export interface MessageComposerProps {
  // Content (controlled)
  content: JSONContent
  onContentChange: (content: JSONContent) => void

  // Attachments (controlled)
  pendingAttachments: PendingAttachment[]
  onRemoveAttachment: (id: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void
  /** Called when files are pasted or dropped into the editor */
  onFileUpload?: (file: File) => Promise<UploadResult>
  /** Current count of images for sequential naming of pasted images */
  imageCount?: number

  // Submit
  onSubmit: () => void
  canSubmit: boolean
  submitLabel?: string
  submittingLabel?: string

  // State
  isSubmitting?: boolean
  hasFailed?: boolean

  // Customization
  placeholder?: string
  disabled?: boolean
  className?: string

  /** How Enter key behaves: "enter" = Enter sends, "cmdEnter" = Cmd+Enter sends */
  messageSendMode?: MessageSendMode

  /** Auto-focus the editor when mounted */
  autoFocus?: boolean

  /** Scope identifier — when it changes, re-focus the editor (if autoFocus) */
  scopeId?: string

  /** Called when ArrowUp is pressed in an empty editor — triggers edit-last-message */
  onEditLastMessage?: () => void
}

export function MessageComposer({
  content,
  onContentChange,
  pendingAttachments,
  onRemoveAttachment,
  fileInputRef,
  onFileSelect,
  onFileUpload,
  imageCount = 0,
  onSubmit,
  canSubmit,
  submitLabel = "Send",
  submittingLabel = "Sending...",
  isSubmitting = false,
  hasFailed = false,
  placeholder = "Type a message...",
  disabled = false,
  className,
  messageSendMode = "enter",
  autoFocus = false,
  scopeId,
  onEditLastMessage,
}: MessageComposerProps) {
  // Controls (buttons, file input) are disabled during both external disable and sending.
  // The editor itself stays editable during sending so mobile keyboards don't close/reopen.
  const controlsDisabled = disabled || isSubmitting

  const richEditorRef = useRef<RichEditorHandle>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const isMobile = useIsMobile()

  // Close inline format toolbar when navigating to a different stream/scope without remount
  useEffect(() => {
    setFormatOpen(false)
  }, [scopeId])

  // Build the send mode hint text (reactive to preference changes)
  const sendHint = useMemo(() => {
    if (messageSendMode === "enter") {
      return `Enter to send · Shift+Enter for new line`
    }
    return `${MOD_SYMBOL}Enter to send`
  }, [messageSendMode])

  // Handle attach button click
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [fileInputRef])

  const handleSubmit = useCallback(() => {
    setFormatOpen(false)
    onSubmit()
  }, [onSubmit])

  // Stable ref so TipTap's captured closure always invokes the current handler
  // without needing to re-register on every render.
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const handleContentChange = useCallback((newContent: JSONContent) => {
    onContentChangeRef.current(newContent)
  }, [])

  const sharedEditor = (
    <RichEditor
      ref={richEditorRef}
      value={content}
      onChange={handleContentChange}
      onSubmit={handleSubmit}
      onFileUpload={onFileUpload}
      imageCount={imageCount}
      placeholder={placeholder}
      disabled={disabled}
      messageSendMode={messageSendMode}
      autoFocus={autoFocus}
      scopeId={scopeId}
      staticToolbarOpen={formatOpen}
      disableSelectionToolbar={isMobile}
      onEditLastMessage={onEditLastMessage}
    />
  )

  // ── Inline layout ────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={300}>
      {/* Message input wrapper */}
      <div className={cn("max-h-[380px] flex flex-col", className)}>
        {/* Attachment bar - shown above input */}
        <PendingAttachments attachments={pendingAttachments} onRemove={onRemoveAttachment} />

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileSelect}
          disabled={controlsDisabled}
        />

        {/* Main input area */}
        <div className="input-glow-wrapper">
          <div className="rounded-[16px] border border-input bg-card p-3 flex flex-col gap-2">
            {/* Editor — bubble toolbar floats above the selection */}
            {sharedEditor}

            {/* Bottom action bar */}
            <div className="flex items-center gap-1">
              {/* Hint text — fills space at left, pushes inserts right */}
              <span className="text-[11px] text-muted-foreground flex-1 select-none pointer-events-none hidden sm:block">
                Select text to format
              </span>
              <span className="text-[11px] text-muted-foreground flex-1 select-none pointer-events-none sm:hidden">
                Select to format
              </span>

              {/* Format toggle — opens/closes inline style bar */}
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
                      setFormatOpen((v) => !v)
                    }}
                    disabled={controlsDisabled}
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
                      richEditorRef.current?.insertEmoji()
                    }}
                    disabled={controlsDisabled}
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
                      richEditorRef.current?.insertMention()
                    }}
                    disabled={controlsDisabled}
                  >
                    <AtSign className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Mention
                </TooltipContent>
              </Tooltip>

              {/* Insert slash command — desktop only */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Insert command"
                    className="h-7 w-7 shrink-0 hidden sm:inline-flex"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      richEditorRef.current?.insertSlash()
                    }}
                    disabled={controlsDisabled}
                  >
                    <Slash className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Command
                </TooltipContent>
              </Tooltip>

              {/* Attach files */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach files"
                    className="h-7 w-7 shrink-0"
                    onClick={handleAttachClick}
                    disabled={controlsDisabled}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Attach files
                </TooltipContent>
              </Tooltip>

              {/* Send button */}
              {hasFailed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        disabled
                        className="h-[30px] w-[30px] shrink-0 p-0 pointer-events-none rounded-md"
                        aria-label={submitLabel}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Remove failed uploads before sending</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  aria-label={isSubmitting ? submittingLabel : submitLabel}
                  className="h-[30px] w-[30px] shrink-0 p-0 rounded-md"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Send hint */}
        <div className="flex justify-end px-1 pt-1">
          <span className="text-[10px] text-muted-foreground opacity-60 hidden sm:block select-none pointer-events-none">
            {sendHint}
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
