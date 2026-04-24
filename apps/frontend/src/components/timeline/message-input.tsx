import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import {
  useDraftComposer,
  getDraftMessageKey,
  useStreamOrDraft,
  useComposerHeightPublish,
  useStreamBootstrap,
  useStashComposer,
} from "@/hooks"
import { useWorkspaceStreams, useWorkspaceUsers } from "@/stores/workspace-store"
import { useUser } from "@/auth"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePreferences } from "@/contexts"
import { useConnectionState } from "@/components/layout/connection-status"
import { FloatingComposerShell, MessageComposer, StashedDraftsPicker } from "@/components/composer"
import { EMPTY_DOC } from "@/lib/prosemirror-utils"
import { commandsApi } from "@/api"
import { hasCommandNode } from "@/lib/commands"
import { serializeToMarkdown } from "@threa/prosemirror"
import { useEditLastMessage } from "./edit-last-message-context"
import { useQuoteReply, type QuoteReplyData } from "./quote-reply-context"
import { StreamTypes, type JSONContent } from "@threa/types"
import type { MentionStreamContext } from "@/hooks/use-mentionables"
import type { PendingAttachment } from "@/hooks/use-attachments"

interface MessageInputProps {
  workspaceId: string
  streamId: string
  disabled?: boolean
  disabledReason?: string
  autoFocus?: boolean
}

function attachmentMatchKey(attachment: Pick<PendingAttachment, "filename" | "mimeType">): string {
  return `${attachment.filename}::${attachment.mimeType}`
}

export function extractUploadedAttachments(content: JSONContent): Array<{
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}> {
  const attachments = new Map<string, { id: string; filename: string; mimeType: string; sizeBytes: number }>()

  const visitNode = (node: JSONContent): void => {
    if (
      node.type === "attachmentReference" &&
      typeof node.attrs?.id === "string" &&
      !node.attrs.id.startsWith("temp_") &&
      typeof node.attrs?.filename === "string" &&
      typeof node.attrs?.mimeType === "string" &&
      typeof node.attrs?.sizeBytes === "number"
    ) {
      attachments.set(node.attrs.id, {
        id: node.attrs.id,
        filename: node.attrs.filename,
        mimeType: node.attrs.mimeType,
        sizeBytes: node.attrs.sizeBytes,
      })
    }

    for (const child of node.content ?? []) {
      visitNode(child)
    }
  }

  visitNode(content)
  return Array.from(attachments.values())
}

export function materializePendingAttachmentReferences(
  content: JSONContent,
  pendingAttachments: PendingAttachment[]
): JSONContent {
  const uploadedQueues = new Map<string, PendingAttachment[]>()
  for (const attachment of pendingAttachments) {
    if (attachment.status !== "uploaded") continue
    const key = attachmentMatchKey(attachment)
    const queue = uploadedQueues.get(key)
    if (queue) {
      queue.push(attachment)
    } else {
      uploadedQueues.set(key, [attachment])
    }
  }

  let nextImageIndex = 1

  const visitNode = (node: JSONContent): JSONContent => {
    if (node.type === "attachmentReference") {
      const filename = typeof node.attrs?.filename === "string" ? node.attrs.filename : ""
      const mimeType =
        typeof node.attrs?.mimeType === "string" && node.attrs.mimeType.length > 0
          ? node.attrs.mimeType
          : "application/octet-stream"
      const isImage = mimeType.startsWith("image/")
      const matchedUpload = uploadedQueues.get(attachmentMatchKey({ filename, mimeType }))?.shift()
      let imageIndex = node.attrs?.imageIndex
      if (isImage && typeof node.attrs?.imageIndex === "number" && node.attrs.imageIndex > 0) {
        imageIndex = node.attrs.imageIndex
      } else if (isImage && matchedUpload) {
        imageIndex = nextImageIndex
      }

      if (matchedUpload) {
        if (isImage) nextImageIndex += 1
        return {
          ...node,
          attrs: {
            ...node.attrs,
            id: matchedUpload.id,
            filename: matchedUpload.filename,
            mimeType: matchedUpload.mimeType,
            sizeBytes: matchedUpload.sizeBytes,
            status: "uploaded",
            imageIndex: isImage ? imageIndex : null,
            error: null,
          },
        }
      }

      if (isImage && typeof imageIndex === "number" && imageIndex > 0) {
        nextImageIndex = Math.max(nextImageIndex, imageIndex + 1)
      }
    }

    if (!node.content) {
      return node
    }

    return {
      ...node,
      content: node.content.map((child) => visitNode(child)),
    }
  }

  const materializedContent = visitNode(content)
  const remainingAttachments = Array.from(uploadedQueues.values()).flatMap((queue) => queue)
  if (remainingAttachments.length === 0) {
    return materializedContent
  }

  const fallbackParagraph: JSONContent = {
    type: "paragraph",
    content: remainingAttachments.flatMap((attachment, index) => {
      const isImage = attachment.mimeType.startsWith("image/")
      const imageIndex = isImage ? nextImageIndex++ : null

      const nodes: JSONContent[] = [
        {
          type: "attachmentReference",
          attrs: {
            id: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            status: "uploaded",
            imageIndex,
            error: null,
          },
        },
      ]

      if (index < remainingAttachments.length - 1) {
        nodes.push({ type: "text", text: " " })
      }

      return nodes
    }),
  }

  return {
    ...materializedContent,
    type: materializedContent.type ?? "doc",
    content: [...(materializedContent.content ?? []), fallbackParagraph],
  }
}

export function MessageInput({ workspaceId, streamId, disabled, disabledReason, autoFocus }: MessageInputProps) {
  const editLastCtx = useEditLastMessage()
  const triggerEditLast = editLastCtx?.triggerEditLast
  const scrollToMessage = editLastCtx?.scrollToMessage
  const navigate = useNavigate()
  const { preferences } = usePreferences()
  const { stream, sendMessage } = useStreamOrDraft(workspaceId, streamId)
  const draftKey = getDraftMessageKey({ type: "stream", streamId })

  // Resolve stream context for broadcast mention filtering.
  // For threads, look up the root stream's type from IDB workspace streams.
  const idbStreams = useWorkspaceStreams(workspaceId)

  // Access is gated at the channel level: threads inherit their member list
  // and bot grants from the root channel. For channels/DMs, read from self.
  const rootStreamId = stream?.rootStreamId
  const { data: currentBootstrap } = useStreamBootstrap(workspaceId, streamId, {
    enabled: !!streamId && !rootStreamId,
  })
  const { data: rootBootstrap } = useStreamBootstrap(workspaceId, rootStreamId ?? "", {
    enabled: !!rootStreamId,
  })
  const accessBootstrap = rootStreamId ? rootBootstrap : currentBootstrap

  const currentUser = useUser()
  const workspaceUsers = useWorkspaceUsers(workspaceId)
  const currentUserRole = useMemo(
    () => workspaceUsers.find((u) => u.workosUserId === currentUser?.id)?.role,
    [workspaceUsers, currentUser?.id]
  )

  const streamContext = useMemo<MentionStreamContext | undefined>(() => {
    if (!stream) return undefined
    const ctx: MentionStreamContext = { streamType: stream.type }

    if (stream.type === StreamTypes.THREAD && stream.rootStreamId) {
      const rootStream = idbStreams.find((s) => s.id === stream.rootStreamId)
      if (rootStream) ctx.rootStreamType = rootStream.type
    }

    // Invite-mode exclusion: everyone who already has channel-level access —
    // since threads inherit access from the root, inviting a root-member to a
    // thread is a no-op (they can already see and @mention inside it).
    if (accessBootstrap?.members) {
      const ids = new Set(accessBootstrap.members.map((m) => m.memberId))
      for (const botId of accessBootstrap.botMemberIds ?? []) ids.add(botId)
      ctx.memberIds = ids
    }

    // Bot mention filter: the same channel-level grants determine mentionability.
    if (accessBootstrap?.botMemberIds) ctx.botMemberIds = new Set(accessBootstrap.botMemberIds)

    ctx.canInviteBots = currentUserRole === "admin" || currentUserRole === "owner"

    return ctx
  }, [stream, idbStreams, accessBootstrap, currentUserRole])

  const composer = useDraftComposer({ workspaceId, draftKey, scopeId: streamId })
  const quoteReplyCtx = useQuoteReply()

  // Stashed drafts — explicit "Save for later" pile scoped to this stream.
  // Active DraftMessage stays one-per-scope; this hook manages the sibling
  // many-per-scope stash and the `?stash=<id>` URL auto-restore.
  const stash = useStashComposer(composer, workspaceId, draftKey)

  // Use a ref so the handler always reads fresh composer state without
  // re-registering on every render (composer object is not memoized).
  const composerRef = useRef(composer)
  composerRef.current = composer

  // Imperative handle for programmatic focus from outside (e.g. quote reply insertion)
  const composerFocusRef = useRef<{ focus: () => void; focusAfterQuoteReply: () => void } | null>(null)

  // Register with QuoteReplyContext to insert quote reply nodes into the composer.
  // Stable deps: quoteReplyCtx is from context, composerRef is a ref.
  useEffect(() => {
    if (!quoteReplyCtx) return
    return quoteReplyCtx.registerHandler((data: QuoteReplyData) => {
      const quoteNode: JSONContent = {
        type: "quoteReply",
        attrs: {
          messageId: data.messageId,
          streamId: data.streamId,
          authorName: data.authorName,
          authorId: data.authorId,
          actorType: data.actorType,
          snippet: data.snippet,
        },
      }

      const currentContent = composerRef.current.content
      const existingBlocks = currentContent.content ?? []

      // Strip trailing empty paragraphs so the quote appends cleanly and we
      // re-add exactly one trailing paragraph for post-quote typing.
      const trimmedBlocks = [...existingBlocks]
      while (
        trimmedBlocks.length > 0 &&
        trimmedBlocks[trimmedBlocks.length - 1].type === "paragraph" &&
        (trimmedBlocks[trimmedBlocks.length - 1].content?.length ?? 0) === 0
      ) {
        trimmedBlocks.pop()
      }

      composerRef.current.setContent({
        type: "doc",
        content: [...trimmedBlocks, quoteNode, { type: "paragraph" }],
      })

      // Focus the composer so the user can start typing immediately
      composerFocusRef.current?.focusAfterQuoteReply()
    })
  }, [quoteReplyCtx])

  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const messageSendMode = preferences?.messageSendMode ?? "enter"
  const isMobile = useIsMobile()
  const connectionState = useConnectionState()
  const isOffline = connectionState === "offline"

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

  // Publish the floating composer's measured height so the scroll area can
  // reserve matching space (Virtuoso Footer, plain-scroll padding-bottom).
  // Disabled while the expanded overlay is open so the scroll area can use its
  // full height behind the overlay.
  useComposerHeightPublish(selfRef, { active: !expanded })

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

  const handleSubmit = useCallback(
    async (editorContent?: JSONContent) => {
      if (!composer.canSend) return

      composer.setIsSending(true)
      setError(null)

      const pendingAttachments = composer.getPendingAttachmentsSnapshot()
      const liveContent = editorContent ?? composer.content
      const normalizedContent = materializePendingAttachmentReferences(liveContent, pendingAttachments)

      // Dispatch as a command only when the editor produced a slashCommand node.
      // Plain text starting with "/" (e.g. "/s") should send as a regular message.
      if (hasCommandNode(normalizedContent)) {
        const commandMarkdown = serializeToMarkdown(normalizedContent).trim()

        // Clear input immediately for responsiveness
        composer.setContent(EMPTY_DOC)
        composer.clearDraft()
        setExpanded(false)

        try {
          const result = await commandsApi.dispatch(workspaceId, {
            command: commandMarkdown,
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

      const attachments = extractUploadedAttachments(normalizedContent)
      const attachmentIds = attachments.map((attachment) => attachment.id)

      // Capture content before clearing
      const contentJson = liveContent

      try {
        // Clear the editor immediately so the composer does not briefly show the
        // just-sent content alongside the optimistic timeline event.
        // We keep the durable draft until send succeeds, so failures can still
        // restore the UI without losing content.
        composer.setContent(EMPTY_DOC)
        setExpanded(false)

        const result = await sendMessage({
          contentJson: normalizedContent,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        })

        composer.setContent(EMPTY_DOC)
        composer.clearDraft()
        composer.clearAttachments()
        if (result.navigateTo) {
          navigate(result.navigateTo, { replace: result.replace ?? false })
        }
      } catch {
        // This only happens for draft promotion failure (stream creation failed)
        // Real stream message failures are handled in the timeline with retry
        composer.setContent(contentJson)
        setError("Failed to create stream. Please try again.")
      } finally {
        composer.setIsSending(false)
      }
    },
    [composer, sendMessage, navigate, workspaceId, streamId]
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

  // Shared composer props used by both inline and expanded layouts
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
    placeholder: isOffline ? "Type a message (sent when back online)" : undefined,
    messageSendMode,
    scopeId: streamId,
    onEditLastMessage: triggerEditLast
      ? () => {
          const unmountedId = triggerEditLast()
          if (!unmountedId) return
          // Message is in the loaded events but not mounted (virtualized out).
          // Ask the stream to scroll it into view — scrollToMessage walks
          // Virtuoso up to the right index and retries until the element lands
          // in the DOM. Poll triggerEditLast until the registry picks up the
          // newly-mounted message (or give up after ~1.2s).
          const scrolled = scrollToMessage?.(unmountedId) ?? false
          if (!scrolled) {
            // No virtualized scroller (non-virtualized path); fall back to
            // a best-effort DOM scroll so keyboard-edit still works.
            const el = document.querySelector(`[data-message-id="${CSS.escape(unmountedId)}"]`)
            el?.scrollIntoView({ block: "center" })
          }
          const deadline = performance.now() + 1200
          const retry = () => {
            if (triggerEditLast() === null) return
            if (performance.now() >= deadline) return
            setTimeout(retry, 60)
          }
          setTimeout(retry, 80)
        }
      : undefined,
    streamContext,
    composerRef: composerFocusRef,
    onStashDraft: stash.handleStashDraft,
    stashedDraftsTrigger: (
      <StashedDraftsPicker
        drafts={stash.drafts}
        canStashCurrent={composer.canSend}
        onStashCurrent={stash.handleStashDraft}
        onRestore={stash.handleRestoreStashed}
        onDelete={stash.handleDeleteStashed}
        controlsDisabled={composer.isSending}
      />
    ),
    stashedDraftsTriggerFab: (
      <StashedDraftsPicker
        drafts={stash.drafts}
        canStashCurrent={composer.canSend}
        onStashCurrent={stash.handleStashDraft}
        onRestore={stash.handleRestoreStashed}
        onDelete={stash.handleDeleteStashed}
        controlsDisabled={composer.isSending}
        size="fab"
      />
    ),
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

      {/* Inline composer — hidden while expanded. Mobile inline editing is handled
          via CSS: `body:has([data-inline-edit])` matches whenever a MessageEditForm or
          UnsentMessageEditForm is mounted (including vaul drawer portals, which live
          under document.body), so the composer is hidden purely from DOM presence.
          This replaces a previous ref-counted React state mechanism that was prone to
          leaks across hydration races and virtualization cycles. */}
      <FloatingComposerShell ref={selfRef} hidden={expanded} data-message-composer-root>
        {!expanded && <MessageComposer {...composerProps} autoFocus={autoFocus} onExpandClick={handleExpandClick} />}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </FloatingComposerShell>
    </>
  )
}
