import { type ChangeEvent, type RefObject } from "react"
import { Paperclip } from "lucide-react"
import { RichEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import type { PendingAttachment } from "@/hooks/use-attachments"

export interface MessageComposerProps {
  // Content (controlled)
  content: string
  onContentChange: (content: string) => void

  // Attachments (controlled)
  pendingAttachments: PendingAttachment[]
  onRemoveAttachment: (id: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void

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
}

export function MessageComposer({
  content,
  onContentChange,
  pendingAttachments,
  onRemoveAttachment,
  fileInputRef,
  onFileSelect,
  onSubmit,
  canSubmit,
  submitLabel = "Send",
  submittingLabel = "Sending...",
  isSubmitting = false,
  hasFailed = false,
  placeholder = "Type a message... (Cmd+Enter to send)",
  disabled = false,
  className,
}: MessageComposerProps) {
  const isDisabled = disabled || isSubmitting

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

          <RichEditor
            value={content}
            onChange={onContentChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
            disabled={isDisabled}
          />

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
