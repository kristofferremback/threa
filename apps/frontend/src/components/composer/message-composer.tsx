import { type ChangeEvent, type RefObject, useMemo } from "react"
import { Paperclip } from "lucide-react"
import { RichEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import type { PendingAttachment, UploadResult } from "@/hooks/use-attachments"
import type { MessageSendMode } from "@threa/types"

/** Platform-appropriate modifier key symbol (⌘ on Mac, Ctrl+ elsewhere) */
const MOD_SYMBOL = navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"

export interface MessageComposerProps {
  // Content (controlled)
  content: string
  onContentChange: (content: string) => void

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
      <div className={className}>
        <PendingAttachments attachments={pendingAttachments} onRemove={onRemoveAttachment} />

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileSelect}
            disabled={isDisabled}
          />

          {/* Upload button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="self-end shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled}
            title="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <div className="relative flex-1">
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
            {/* Send mode hint - positioned absolutely to avoid layout shift */}
            <div className="absolute right-2 bottom-1 text-[11px] text-muted-foreground/60 pointer-events-none select-none">
              {sendHint}
            </div>
          </div>

          {hasFailed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="self-end">
                  <Button disabled className="pointer-events-none">
                    {submitLabel}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Remove failed uploads before sending</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={onSubmit} disabled={!canSubmit} className="self-end">
              {isSubmitting ? submittingLabel : submitLabel}
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
