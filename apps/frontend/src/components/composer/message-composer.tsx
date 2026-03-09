import { type ChangeEvent, type RefObject, useMemo, useCallback, useRef, useState, useEffect } from "react"
import { AtSign, Slash, Paperclip, ArrowUp, Maximize2, Minimize2, X, Plus } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { RichEditor, EditorToolbar } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import { stripMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import type { PendingAttachment, UploadResult } from "@/hooks/use-attachments"
import type { MessageSendMode, JSONContent } from "@threa/types"
import type { MentionStreamContext } from "@/hooks/use-mentionables"
import type { Editor } from "@tiptap/react"
import { serializeToMarkdown } from "@threa/prosemirror"

/** Platform-appropriate modifier key symbol (⌘ on Mac, Ctrl+ elsewhere) */
const MOD_SYMBOL = navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"

/** Extract plain text from ProseMirror JSON for preview display */
function getPlainText(doc: JSONContent): string {
  const markdown = serializeToMarkdown(doc)
  const plain = stripMarkdown(markdown)
    // Collapsed preview should show list item text, not markdown list markers.
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
  return plain.replace(/\s+/g, " ").trim()
}

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

  /** Called when the desktop expand button is clicked — opens fullscreen document editor */
  onExpandClick?: () => void

  /** When true, the composer fills its container with full-height editor and always-visible toolbar */
  expanded?: boolean
  /** Called to collapse the expanded editor back to inline mode */
  onCollapse?: () => void
  /** Stream context for filtering which broadcast mentions (@channel, @here) are available */
  streamContext?: MentionStreamContext
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
  onExpandClick,
  expanded = false,
  onCollapse,
  streamContext,
}: MessageComposerProps) {
  // Controls (buttons, file input) are disabled during both external disable and sending.
  // The editor itself stays editable during sending so mobile keyboards don't close/reopen.
  const controlsDisabled = disabled || isSubmitting

  const richEditorRef = useRef<RichEditorHandle>(null)
  const [mobileToolbarEditor, setMobileToolbarEditor] = useState<Editor | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const [mobileFocused, setMobileFocused] = useState(false)
  const [mobileLinkPopoverOpen, setMobileLinkPopoverOpen] = useState(false)
  const isMobile = useIsMobile()
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close inline format toolbar and collapse expansion when navigating to a different stream/scope
  useEffect(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
    setFormatOpen(false)
    setMobileExpanded(false)
    setMobileFocused(false)
    setMobileLinkPopoverOpen(false)
  }, [scopeId])

  // Reset mobile-only state when viewport crosses the mobile/desktop threshold
  useEffect(() => {
    if (!isMobile) {
      setMobileExpanded(false)
      setMobileFocused(false)
      setMobileLinkPopoverOpen(false)
    }
  }, [isMobile])

  // Track focus state for mobile progressive disclosure.
  // Uses a small delay on blur to avoid flicker when focus moves between editor and action bar buttons.
  const handleFocusCapture = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
    setMobileFocused(true)
  }, [])

  const handleBlurCapture = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => {
      setMobileFocused(false)
      setMobileExpanded(false)
      setFormatOpen(false)
      setMobileLinkPopoverOpen(false)
    }, 150)
  }, [])

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    },
    []
  )

  // Build the send mode hint text (reactive to preference changes).
  // Expanded (fullscreen) and mobile always use cmdEnter — on mobile the send button
  // is the only way to send, so Enter just inserts a newline.
  const effectiveSendMode = expanded || isMobile ? "cmdEnter" : messageSendMode
  const sendHint = useMemo(() => {
    if (effectiveSendMode === "enter") {
      return `Enter to send · Shift+Enter for new line`
    }
    return `${MOD_SYMBOL}Enter to send`
  }, [effectiveSendMode])

  // Handle attach button click
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [fileInputRef])

  const handleSubmit = useCallback(() => {
    setFormatOpen(false)
    setMobileExpanded(false)
    setMobileLinkPopoverOpen(false)
    onSubmit()
  }, [onSubmit])

  // Stable ref so TipTap's captured closure always invokes the current handler
  // without needing to re-register on every render.
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const handleContentChange = useCallback((newContent: JSONContent) => {
    onContentChangeRef.current(newContent)
  }, [])

  const setRichEditorHandle = useCallback((handle: RichEditorHandle | null) => {
    richEditorRef.current = handle
    const nextEditor = handle?.getEditor() ?? null
    setMobileToolbarEditor((currentEditor) => (currentEditor === nextEditor ? currentEditor : nextEditor))
  }, [])

  // Plain text preview for the collapsed mobile single-line view
  const contentPreview = useMemo(() => (isMobile ? getPlainText(content) : ""), [isMobile, content])

  const sharedEditor = (
    <RichEditor
      ref={setRichEditorHandle}
      value={content}
      onChange={handleContentChange}
      onSubmit={handleSubmit}
      onFileUpload={onFileUpload}
      imageCount={imageCount}
      placeholder={placeholder}
      disabled={disabled}
      messageSendMode={effectiveSendMode}
      autoFocus={autoFocus}
      scopeId={scopeId}
      staticToolbarOpen={!isMobile && formatOpen}
      disableSelectionToolbar={isMobile}
      onEditLastMessage={onEditLastMessage}
      streamContext={streamContext}
    />
  )

  // ── Send button (shared between states) ──────────────────────────────
  const sendButton = hasFailed ? (
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
      onClick={handleSubmit}
      disabled={!canSubmit}
      aria-label={isSubmitting ? submittingLabel : submitLabel}
      className="h-[30px] w-[30px] shrink-0 p-0 rounded-md"
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  )

  // ── Expanded (fullscreen) layout ──────────────────────────────────────────
  // Trailing content for the inline toolbar: just the close X
  const expandedTrailingContent = expanded ? (
    <div className="flex items-center gap-0.5 shrink-0 ml-auto">
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close editor"
            className="h-8 w-8 p-0 hover:bg-muted"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onCollapse?.()}
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Close (Esc)
        </TooltipContent>
      </Tooltip>
    </div>
  ) : undefined

  if (expanded) {
    return (
      <TooltipProvider delayDuration={300}>
        <div className={cn("relative flex flex-col h-full bg-background", className)}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileSelect}
            disabled={controlsDisabled}
          />

          {/* Editor — fills remaining space, toolbar + actions in one bar via toolbarTrailingContent */}
          <div
            className="flex-1 min-h-0 overflow-y-auto px-4 [&_.tiptap]:max-h-none [&_.tiptap]:min-h-[200px]"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button,a,input,textarea,[contenteditable],[role='button']")) return
              richEditorRef.current?.focus()
            }}
          >
            <RichEditor
              ref={setRichEditorHandle}
              value={content}
              onChange={handleContentChange}
              onSubmit={handleSubmit}
              onFileUpload={onFileUpload}
              imageCount={imageCount}
              placeholder={placeholder}
              disabled={disabled}
              messageSendMode="cmdEnter"
              autoFocus
              scopeId={scopeId}
              staticToolbarOpen
              disableSelectionToolbar
              onEditLastMessage={onEditLastMessage}
              toolbarTrailingContent={expandedTrailingContent}
              streamContext={streamContext}
              belowToolbarContent={
                pendingAttachments.length > 0 ? (
                  <div className="pt-1 pb-2 border-b border-border/50 [&>div]:mb-0">
                    <PendingAttachments attachments={pendingAttachments} onRemove={onRemoveAttachment} />
                  </div>
                ) : undefined
              }
            />
            {/* Extra space so the writing position can be centered on screen */}
            <div className="h-[50vh]" />
          </div>

          {/* Floating action drawer + send button — bottom-right corner */}
          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 group/fab">
            {/* Action drawer — slides out from behind the + button on hover or focus-within */}
            <div className="flex items-center gap-1 overflow-hidden max-w-0 opacity-0 group-hover/fab:max-w-[200px] group-hover/fab:opacity-100 group-focus-within/fab:max-w-[200px] group-focus-within/fab:opacity-100 transition-all duration-200 ease-out">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Insert emoji"
                    className="h-[30px] w-[30px] shrink-0 p-0 rounded-md bg-background shadow-md"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Insert mention"
                    className="h-[30px] w-[30px] shrink-0 p-0 rounded-md bg-background shadow-md"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Insert command"
                    className="h-[30px] w-[30px] shrink-0 p-0 rounded-md bg-background shadow-md"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Attach files"
                    className="h-[30px] w-[30px] shrink-0 p-0 rounded-md bg-background shadow-md"
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
            </div>
            {/* Plus button — triggers drawer reveal */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Actions"
              className="h-[30px] w-[30px] shrink-0 p-0 rounded-md bg-background shadow-md group-hover/fab:[&_svg]:rotate-45 group-focus-within/fab:[&_svg]:rotate-45 [&_svg]:transition-transform"
              tabIndex={-1}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {/* Send button */}
            {hasFailed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      disabled
                      className="h-[30px] w-[30px] shrink-0 p-0 pointer-events-none rounded-md shadow-md"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    aria-label={isSubmitting ? submittingLabel : submitLabel}
                    className="h-[30px] w-[30px] shrink-0 p-0 rounded-md shadow-md"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  {sendHint}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </TooltipProvider>
    )
  }

  // ── Inline layout ────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={300}>
      {/* Message input wrapper — dvh units respect the virtual keyboard on mobile */}
      <div
        className={cn(
          "flex flex-col transition-[max-height,min-height] duration-200 ease-out",
          mobileExpanded ? "max-h-[75dvh] min-h-[75dvh]" : "max-h-[380px] min-h-0",
          className
        )}
        onFocusCapture={isMobile ? handleFocusCapture : undefined}
        onBlurCapture={isMobile ? handleBlurCapture : undefined}
      >
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
        <div className="input-glow-wrapper flex-1 flex flex-col min-h-0">
          <div
            className={cn(
              "rounded-[16px] border border-input bg-card flex flex-col flex-1 min-h-0",
              // Compact padding when mobile-unfocused (single line), normal otherwise
              isMobile && !mobileFocused ? "px-3 py-2" : "p-3 gap-2",
              // When mobile-expanded, let the editor grow and override its internal max-height
              mobileExpanded && "[&_.tiptap]:max-h-none"
            )}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button,a,input,textarea,[contenteditable],[role='button']")) return
              // On mobile unfocused, reveal the editor first then focus on next frame
              if (isMobile && !mobileFocused) {
                setMobileFocused(true)
                requestAnimationFrame(() => richEditorRef.current?.focus())
                return
              }
              richEditorRef.current?.focus()
            }}
          >
            {/* Mobile unfocused: single-line preview with truncated text + send button */}
            {isMobile && !mobileFocused && (
              <div className="flex items-center gap-2 min-h-[30px]">
                <span className="text-sm text-muted-foreground flex-1 truncate select-none">
                  {contentPreview || placeholder}
                </span>
                {sendButton}
              </div>
            )}

            {/* Editor surface — hidden on mobile when unfocused (stays mounted to preserve state) */}
            <div
              className={cn(
                "flex-1 min-h-0",
                isMobile && !mobileFocused && "hidden",
                mobileExpanded && "overflow-y-auto"
              )}
            >
              {sharedEditor}
            </div>

            {/* Bottom action bar — visible on desktop always, on mobile only when focused.
               onMouseDown preventDefault keeps editor focus on mobile so the virtual keyboard
               stays open when tapping any button in this bar. */}
            <div
              className={cn("flex items-center gap-1", isMobile && !mobileFocused && "hidden")}
              onMouseDown={(e) => e.preventDefault()}
            >
              {/* Hint text — desktop only */}
              <span className="text-[11px] text-muted-foreground flex-1 select-none pointer-events-none hidden sm:block">
                Select text to format
              </span>
              {isMobile && <span className="flex-1" />}

              {/* Expand/collapse toggle — mobile: expand inline, desktop: open fullscreen editor */}
              {isMobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={mobileExpanded ? "Minimize editor" : "Expand editor"}
                      aria-pressed={mobileExpanded}
                      className="h-7 w-7 shrink-0"
                      onClick={() => setMobileExpanded((v) => !v)}
                    >
                      {mobileExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {mobileExpanded ? "Minimize" : "Expand"}
                  </TooltipContent>
                </Tooltip>
              )}
              {!isMobile && onExpandClick && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Expand to fullscreen editor"
                      className="h-7 w-7 shrink-0"
                      onClick={onExpandClick}
                      disabled={controlsDisabled}
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Expand editor
                  </TooltipContent>
                </Tooltip>
              )}

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
                    onClick={() => setFormatOpen((v) => !v)}
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
                    onClick={() => richEditorRef.current?.insertEmoji()}
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
                    onClick={() => richEditorRef.current?.insertMention()}
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
                    onClick={() => richEditorRef.current?.insertSlash()}
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
              {sendButton}
            </div>

            {/* Mobile formatting toolbar — rendered below action bar, above keyboard */}
            {isMobile && formatOpen && (
              <EditorToolbar
                editor={mobileToolbarEditor}
                isVisible
                inline
                inlinePosition="below"
                linkPopoverOpen={mobileLinkPopoverOpen}
                onLinkPopoverOpenChange={setMobileLinkPopoverOpen}
                showSpecialInputControls
              />
            )}
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
