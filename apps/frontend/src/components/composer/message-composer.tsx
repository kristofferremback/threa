import { type ChangeEvent, type RefObject, useMemo, useCallback, useRef, useState, useEffect } from "react"
import { Expand, Type, AtSign, Slash, Paperclip } from "lucide-react"
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

  /** Called when expand button is clicked to open document editor */
  onExpandClick?: () => void

  /** Auto-focus the editor when mounted */
  autoFocus?: boolean

  /** Scope identifier — when it changes, re-focus the editor (if autoFocus) */
  scopeId?: string
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
  onExpandClick,
  autoFocus = false,
  scopeId,
}: MessageComposerProps) {
  // Controls (buttons, file input) are disabled during both external disable and sending.
  // The editor itself stays editable during sending so mobile keyboards don't close/reopen.
  const controlsDisabled = disabled || isSubmitting

  const richEditorRef = useRef<RichEditorHandle>(null)
  const [formatBubbleOpen, setFormatBubbleOpen] = useState(false)

  // Reset bubble when scope changes (stream navigation without remount)
  useEffect(() => {
    setFormatBubbleOpen(false)
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

  // Wrap onSubmit to reset bubble state on send
  const handleSubmit = useCallback(() => {
    setFormatBubbleOpen(false)
    onSubmit()
  }, [onSubmit])

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
            {/* Editor — bubble toolbar floats above on selection or forceVisible */}
            <RichEditor
              ref={richEditorRef}
              value={content}
              onChange={onContentChange}
              onSubmit={handleSubmit}
              onFileUpload={onFileUpload}
              imageCount={imageCount}
              placeholder={placeholder}
              disabled={disabled}
              messageSendMode={messageSendMode}
              forceToolbarVisible={formatBubbleOpen}
              autoFocus={autoFocus}
              scopeId={scopeId}
            />

            {/* Bottom action bar */}
            <div className="flex items-center gap-1">
              {/* Format toggle — opens/closes bubble manually */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Toggle formatting toolbar"
                    className={cn("h-7 w-7 shrink-0", formatBubbleOpen && "bg-muted-foreground/20 text-foreground")}
                    onClick={() => setFormatBubbleOpen((v) => !v)}
                    disabled={controlsDisabled}
                  >
                    <Type className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Format
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

              {/* Insert slash command */}
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

              <div className="flex-1" />

              {/* Expand button — desktop only, opens document editor */}
              {onExpandClick && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 rounded-lg hover:bg-primary/10 hover:text-primary"
                      onClick={onExpandClick}
                      disabled={controlsDisabled}
                    >
                      <Expand className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span className="font-medium">Expand editor</span>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Send hint */}
              <span className="text-xs text-muted-foreground hidden sm:block">{sendHint}</span>

              {/* Send button */}
              {hasFailed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button disabled className="pointer-events-none h-7 rounded-lg text-xs px-3">
                        {submitLabel}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Remove failed uploads before sending</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="h-7 rounded-lg shrink-0 text-xs px-3"
                >
                  {isSubmitting ? submittingLabel : submitLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
