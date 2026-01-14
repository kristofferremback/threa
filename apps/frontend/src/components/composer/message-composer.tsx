import { type ChangeEvent, type RefObject, useMemo } from "react"
import { Paperclip, Expand } from "lucide-react"
import { RichEditor } from "@/components/editor"
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
}: MessageComposerProps) {
  const isDisabled = disabled || isSubmitting

  // Build the send mode hint text (reactive to preference changes)
  const sendHint = useMemo(() => {
    if (messageSendMode === "enter") {
      return `Enter to send · Shift+Enter for new line`
    }
    return `${MOD_SYMBOL}Enter to send`
  }, [messageSendMode])

  return (
    <TooltipProvider delayDuration={300}>
      {/* Message input wrapper with premium styling */}
      <div className={cn("max-h-[380px] flex flex-col", className)}>
        {/* Attachment bar - shown above input */}
        <PendingAttachments attachments={pendingAttachments} onRemove={onRemoveAttachment} />

        {/* Main input area with glow effect */}
        <div className="input-glow-wrapper">
          <div className="rounded-xl border border-input bg-card">
            {/* Editor row */}
            <div className="flex items-start gap-2 px-4 py-3">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={onFileSelect}
                disabled={isDisabled}
              />

              {/* Left buttons */}
              <div className="flex items-center gap-1 pt-1">
                {/* Expand button - opens document editor modal */}
                {onExpandClick && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={onExpandClick}
                        disabled={isDisabled}
                      >
                        <Expand className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Expand editor</TooltipContent>
                  </Tooltip>
                )}

                {/* Upload button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isDisabled}
                      aria-label="Attach files"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Attach files</TooltipContent>
                </Tooltip>
              </div>

              {/* Editor */}
              <div className="flex-1 min-w-0">
                <RichEditor
                  value={content}
                  onChange={onContentChange}
                  onSubmit={onSubmit}
                  onFileUpload={onFileUpload}
                  imageCount={imageCount}
                  placeholder={placeholder}
                  disabled={isDisabled}
                  messageSendMode={messageSendMode}
                />
              </div>

              {/* Send button */}
              {hasFailed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="pt-1">
                      <Button disabled className="pointer-events-none h-8">
                        {submitLabel}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Remove failed uploads before sending</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button onClick={onSubmit} disabled={!canSubmit} className="h-8 pt-1">
                  {isSubmitting ? submittingLabel : submitLabel}
                </Button>
              )}
            </div>

            {/* Footer row - hints */}
            <div className="flex items-center justify-end px-4 py-2 border-t border-border/50 bg-muted/20 rounded-b-xl">
              <span className="text-[11px] text-muted-foreground">{sendHint}</span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
