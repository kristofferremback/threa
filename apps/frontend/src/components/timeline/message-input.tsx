import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { useDraftComposer, getDraftMessageKey, useStreamOrDraft } from "@/hooks"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePreferences } from "@/contexts"
import { useConnectionState } from "@/components/layout/connection-status"
import { MessageComposer } from "@/components/composer"
import { commandsApi } from "@/api"
import { isCommand } from "@/lib/commands"
import { serializeToMarkdown } from "@threa/prosemirror"
import { useEditLastMessage } from "./edit-last-message-context"
import { useInlineEdit } from "./inline-edit-context"
import { StreamTypes, type JSONContent } from "@threa/types"
import type { MentionStreamContext } from "@/hooks/use-mentionables"

interface MessageInputProps {
  workspaceId: string
  streamId: string
  disabled?: boolean
  disabledReason?: string
  autoFocus?: boolean
}

export function MessageInput({ workspaceId, streamId, disabled, disabledReason, autoFocus }: MessageInputProps) {
  const { triggerEditLast } = useEditLastMessage() ?? {}
  const inlineEdit = useInlineEdit()
  const navigate = useNavigate()
  const { preferences } = usePreferences()
  const { stream, sendMessage } = useStreamOrDraft(workspaceId, streamId)
  const draftKey = getDraftMessageKey({ type: "stream", streamId })

  // Resolve stream context for broadcast mention filtering.
  // For threads, look up the root stream's type from IDB workspace streams.
  const idbStreams = useWorkspaceStreams(workspaceId)
  const streamContext = useMemo<MentionStreamContext | undefined>(() => {
    if (!stream) return undefined
    const ctx: MentionStreamContext = { streamType: stream.type }
    if (stream.type === StreamTypes.THREAD && stream.rootStreamId) {
      const rootStream = idbStreams.find((s) => s.id === stream.rootStreamId)
      if (rootStream) ctx.rootStreamType = rootStream.type
    }
    return ctx
  }, [stream, idbStreams])

  const composer = useDraftComposer({ workspaceId, draftKey, scopeId: streamId })
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const messageSendMode = preferences?.messageSendMode ?? "enter"
  const isMobile = useIsMobile()
  const hideForInlineEdit = isMobile && !!inlineEdit?.isEditingInline

  // Resolve the portal target for the expanded overlay by walking up from our own DOM node
  // to the closest [data-editor-zone] ancestor. Works for both main stream view and thread panel.
  const selfRef = useRef<HTMLDivElement>(null)
  const expandedRef = useRef<HTMLDivElement>(null)
  const portalTargetRef = useRef<HTMLElement | null>(null)

  // Reset local state on stream change (e.g., draft promotion) without remounting
  useEffect(() => {
    setError(null)
    setExpanded(false)
  }, [streamId])

  // Collapse expanded overlay when viewport crosses to mobile (expand is desktop-only)
  useEffect(() => {
    if (isMobile) setExpanded(false)
  }, [isMobile])

  // Resolve the portal target lazily on expand to avoid silent blank screen
  // if the component mounts before the [data-editor-zone] ancestor exists.
  const handleExpandClick = useCallback(() => {
    portalTargetRef.current = selfRef.current?.closest<HTMLElement>("[data-editor-zone]") ?? null
    if (!portalTargetRef.current) {
      console.warn("MessageInput: no [data-editor-zone] ancestor found — expand disabled")
      return
    }
    setExpanded(true)
  }, [])
  const handleCollapse = useCallback(() => setExpanded(false), [])

  // Escape to close — only when focus is inside this expanded editor
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key !== "Escape") return

      const expandedElement = expandedRef.current
      if (!expandedElement) return

      const activeElement = document.activeElement as HTMLElement | null
      const focusedEditor = activeElement?.closest<HTMLElement>('[contenteditable="true"]')
      if (focusedEditor && expandedElement.contains(focusedEditor)) return

      e.preventDefault()
      setExpanded(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [expanded])

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
      setExpanded(false)

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
    setExpanded(false)

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

  // Shared composer props used by both inline and expanded layouts
  const connectionState = useConnectionState()
  const isOffline = connectionState !== "connected"

  const composerProps = {
    content: composer.content,
    onContentChange: composer.handleContentChange,
    pendingAttachments: composer.pendingAttachments,
    onRemoveAttachment: composer.handleRemoveAttachment,
    fileInputRef: composer.fileInputRef,
    onFileSelect: composer.handleFileSelect,
    onFileUpload: composer.uploadFile,
    imageCount: composer.imageCount,
    onSubmit: handleSubmit,
    canSubmit: composer.canSend,
    isSubmitting: composer.isSending,
    hasFailed: composer.hasFailed,
    placeholder: isOffline ? "Type a message — sent when back online" : undefined,
    messageSendMode,
    scopeId: streamId,
    onEditLastMessage: triggerEditLast,
    streamContext,
  } as const

  return (
    <>
      {/* Expanded overlay — portaled into the stream view area */}
      {expanded &&
        portalTargetRef.current &&
        createPortal(
          <div ref={expandedRef} className="absolute inset-0 z-30 bg-background">
            <MessageComposer {...composerProps} expanded onCollapse={handleCollapse} autoFocus />
          </div>,
          portalTargetRef.current
        )}

      {/* Inline composer — hidden while expanded or during mobile inline editing */}
      <div ref={selfRef} className={expanded || hideForInlineEdit ? "border-t hidden" : "border-t"}>
        <div className="pt-3 px-3 pb-1 sm:pt-6 sm:px-6 sm:pb-1 mx-auto max-w-[800px] w-full min-w-0">
          {!expanded && <MessageComposer {...composerProps} autoFocus={autoFocus} onExpandClick={handleExpandClick} />}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </>
  )
}
