import { useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useDraftComposer, getDraftMessageKey, useStreamOrDraft } from "@/hooks"
import { usePreferences } from "@/contexts"
import { MessageComposer } from "@/components/composer"
import { DocumentEditorModal } from "@/components/editor"
import { commandsApi } from "@/api"
import { isCommand } from "@/lib/commands"
import { cn } from "@/lib/utils"
import { serializeToMarkdown, parseMarkdown } from "@threa/prosemirror"
import type { JSONContent } from "@threa/types"

interface MessageInputProps {
  workspaceId: string
  streamId: string
  streamName?: string
  disabled?: boolean
  disabledReason?: string
  autoFocus?: boolean
}

export function MessageInput({
  workspaceId,
  streamId,
  streamName,
  disabled,
  disabledReason,
  autoFocus,
}: MessageInputProps) {
  const navigate = useNavigate()
  const { preferences } = usePreferences()
  const { sendMessage } = useStreamOrDraft(workspaceId, streamId)
  const draftKey = getDraftMessageKey({ type: "stream", streamId })

  const composer = useDraftComposer({ workspaceId, draftKey, scopeId: streamId })
  const [error, setError] = useState<string | null>(null)
  const [docEditorOpen, setDocEditorOpen] = useState(false)
  const messageSendMode = preferences?.messageSendMode ?? "enter"

  const handleSubmit = useCallback(async () => {
    if (!composer.canSend) return

    composer.setIsSending(true)
    setError(null)

    // Serialize content to markdown to check for commands
    const contentMarkdown = serializeToMarkdown(composer.content)

    // Detect slash commands and dispatch them instead of sending as messages
    if (isCommand(contentMarkdown.trim())) {
      // Clear input immediately for responsiveness
      const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
      composer.setContent(emptyDoc)
      composer.clearDraft()

      try {
        const result = await commandsApi.dispatch(workspaceId, {
          command: contentMarkdown.trim(),
          streamId,
        })

        if (!result.success) {
          setError(result.error)
        }
      } catch {
        setError("Failed to dispatch command. Please try again.")
      } finally {
        composer.setIsSending(false)
      }
      return
    }

    const attachmentIds = composer.uploadedIds
    // Capture full attachment info BEFORE clearing for optimistic UI
    const attachments = composer.pendingAttachments
      .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
      .map(({ id, filename, mimeType, sizeBytes }) => ({ id, filename, mimeType, sizeBytes }))

    // Capture content before clearing
    const contentJson = composer.content

    // Clear input immediately for responsiveness
    const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
    composer.setContent(emptyDoc)
    composer.clearDraft()
    composer.clearAttachments()

    try {
      const result = await sendMessage({
        contentJson,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      if (result.navigateTo) {
        navigate(result.navigateTo, { replace: result.replace ?? false })
      }
    } catch {
      // This only happens for draft promotion failure (stream creation failed)
      // Real stream message failures are handled in the timeline with retry
      setError("Failed to create stream. Please try again.")
    } finally {
      composer.setIsSending(false)
    }
  }, [composer, sendMessage, navigate, workspaceId, streamId])

  // Send from document editor modal
  const handleDocEditorSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return

      setError(null)

      // Clear composer content immediately so it doesn't persist when modal closes
      const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
      composer.setContent(emptyDoc)
      composer.clearDraft()

      try {
        const result = await sendMessage({
          content: trimmed,
          contentFormat: "markdown",
        })
        if (result.navigateTo) {
          navigate(result.navigateTo, { replace: result.replace ?? false })
        }
      } catch {
        setError("Failed to send message. Please try again.")
      }
    },
    [sendMessage, navigate, composer]
  )

  // Sync content from doc editor back to composer when dismissed
  const handleDocEditorDismiss = useCallback(
    (content: string) => {
      // Parse markdown back to ProseMirror JSON
      const contentJson = parseMarkdown(content)
      composer.setContent(contentJson)
    },
    [composer]
  )

  if (disabled && disabledReason) {
    return (
      <div className="border-t">
        <div className="p-6 mx-auto max-w-[800px] w-full min-w-0">
          <div className="flex items-center justify-center py-3 px-4 rounded-md bg-muted/50">
            <p className="text-sm text-muted-foreground text-center">{disabledReason}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t">
      {/* Message composer - hidden when doc editor is open */}
      <div
        className={cn(
          "p-6 mx-auto max-w-[800px] w-full min-w-0 transition-all duration-200",
          docEditorOpen && "h-0 p-0 overflow-hidden opacity-0"
        )}
      >
        <MessageComposer
          content={composer.content}
          onContentChange={composer.handleContentChange}
          pendingAttachments={composer.pendingAttachments}
          onRemoveAttachment={composer.handleRemoveAttachment}
          fileInputRef={composer.fileInputRef}
          onFileSelect={composer.handleFileSelect}
          onFileUpload={composer.uploadFile}
          imageCount={composer.imageCount}
          onSubmit={handleSubmit}
          canSubmit={composer.canSend}
          isSubmitting={composer.isSending}
          hasFailed={composer.hasFailed}
          messageSendMode={messageSendMode}
          onExpandClick={() => setDocEditorOpen(true)}
          autoFocus={autoFocus}
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      {/* Document editor modal */}
      <DocumentEditorModal
        open={docEditorOpen}
        onOpenChange={setDocEditorOpen}
        initialContent={serializeToMarkdown(composer.content)}
        onSend={handleDocEditorSend}
        onDismiss={handleDocEditorDismiss}
        streamName={streamName ?? "this stream"}
      />
    </div>
  )
}
