import { useState, useEffect, useLayoutEffect, useCallback, useRef, useId, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Expand } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { RichEditor, EditorToolbar, EditorActionBar, DocumentEditorModal } from "@/components/editor"
import type { RichEditorHandle } from "@/components/editor"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMessageService } from "@/contexts"
import { messageKeys } from "@/api/messages"
import { serializeToMarkdown, parseMarkdown } from "@threa/prosemirror"
import type { JSONContent } from "@threa/types"
import type { Editor } from "@tiptap/react"

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
const MOD_KEY_NAME = navigator.platform?.toLowerCase().includes("mac") ? "Command" : "Control"

interface MessageEditFormProps {
  messageId: string
  workspaceId: string
  initialContentJson?: JSONContent
  onSave: () => void
  onCancel: () => void
  /** Author display name — shown in the mobile drawer header for context */
  authorName?: string
}

export function MessageEditForm({
  messageId,
  workspaceId,
  initialContentJson,
  onSave,
  onCancel,
  authorName,
}: MessageEditFormProps) {
  const queryClient = useQueryClient()
  const messageService = useMessageService()
  const isMobile = useIsMobile()
  const [contentJson, setContentJson] = useState<JSONContent>(initialContentJson ?? EMPTY_DOC)
  const [isSaving, setIsSaving] = useState(false)
  const [docEditorOpen, setDocEditorOpen] = useState(false)
  const [initialMarkdown] = useState(() => serializeToMarkdown(initialContentJson ?? EMPTY_DOC).trim())

  // Mobile drawer state
  const [formatOpen, setFormatOpen] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const [mobileLinkPopoverOpen, setMobileLinkPopoverOpen] = useState(false)
  const richEditorRef = useRef<RichEditorHandle>(null)
  const mobileActionBarRef = useRef<HTMLDivElement>(null)
  const drawerContentRef = useRef<HTMLDivElement>(null)
  const [mobileToolbarEditor, setMobileToolbarEditor] = useState<Editor | null>(null)
  const instructionsId = useId()
  // Clear Vaul's cached inline styles when toggling expansion or toolbar so our
  // CSS classes take effect. Vaul's keyboard handling sets inline style.height
  // which overrides class-based heights in Chrome and prevents flex recalculation
  // when children change size. Since we use dvh units (which already account for
  // the virtual keyboard), Vaul's height adjustments are redundant.
  useLayoutEffect(() => {
    const el = drawerContentRef.current
    if (!el) return
    el.style.height = ""
    el.style.maxHeight = ""
    el.style.bottom = ""
    // Force reflow so Chrome's compositing layer updates
    void el.offsetHeight
  }, [mobileExpanded, formatOpen])

  useEffect(() => {
    if (isMobile) return // vaul handles Escape via onOpenChange
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isMobile, onCancel])

  const setRichEditorHandle = useCallback((handle: RichEditorHandle | null) => {
    richEditorRef.current = handle
    const nextEditor = handle?.getEditor() ?? null
    setMobileToolbarEditor((currentEditor) => (currentEditor === nextEditor ? currentEditor : nextEditor))
  }, [])

  const saveEdit = useCallback(
    async (json: JSONContent, markdown: string) => {
      setIsSaving(true)
      try {
        await messageService.update(workspaceId, messageId, { contentJson: json, contentMarkdown: markdown })
        queryClient.invalidateQueries({ queryKey: messageKeys.versions(workspaceId, messageId) })
        onSave()
      } catch {
        toast.error("Failed to save edit")
      } finally {
        setIsSaving(false)
      }
    },
    [workspaceId, messageId, onSave, queryClient, messageService]
  )

  const handleSubmit = useCallback(async () => {
    const contentMarkdown = serializeToMarkdown(contentJson)
    const trimmed = contentMarkdown.trim()
    if (!trimmed) return
    if (trimmed === initialMarkdown) {
      onCancel()
      return
    }
    setFormatOpen(false)
    setMobileExpanded(false)
    setMobileLinkPopoverOpen(false)
    await saveEdit(contentJson, trimmed)
  }, [contentJson, saveEdit, initialMarkdown, onCancel])

  const handleDocEditorSend = useCallback(
    async (markdown: string) => {
      const trimmed = markdown.trim()
      if (!trimmed) return
      if (trimmed === initialMarkdown) {
        setDocEditorOpen(false)
        onCancel()
        return
      }
      setDocEditorOpen(false)
      await saveEdit(parseMarkdown(trimmed), trimmed)
    },
    [saveEdit, initialMarkdown, onCancel]
  )

  const handleDocEditorDismiss = useCallback((markdown: string) => {
    const json = parseMarkdown(markdown)
    setContentJson(json)
  }, [])

  const screenReaderInstructions = useMemo(() => {
    if (isMobile) {
      return `Press ${MOD_KEY_NAME}+Enter to save. Tab and Shift+Tab indent content. Press Escape to leave the editor.`
    }

    return "Press Enter to save. Tab and Shift+Tab indent content. Press Escape to cancel editing."
  }, [isMobile])

  const focusMobileActionBar = useCallback(() => {
    mobileActionBarRef.current?.focus()
  }, [])

  // Mobile: Drawer bottom sheet
  if (isMobile) {
    const trailingContent = (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Cancel edit"
          className="h-8 px-2.5 text-xs shrink-0"
          onPointerDown={(e) => e.preventDefault()}
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          aria-label={isSaving ? "Saving..." : "Save edit"}
          className="h-8 px-3 text-xs shrink-0"
          onPointerDown={(e) => e.preventDefault()}
          onClick={handleSubmit}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </>
    )

    return (
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) setTimeout(onCancel, 300)
        }}
      >
        <DrawerContent
          ref={drawerContentRef}
          className={mobileExpanded ? "!h-[100dvh] rounded-t-none" : "max-h-[85dvh]"}
        >
          <DrawerTitle className="sr-only">Edit message</DrawerTitle>
          <p id={instructionsId} className="sr-only">
            {screenReaderInstructions}
          </p>

          <div className="flex flex-col flex-1 min-h-0 px-4 pt-1">
            {/* Author context */}
            {authorName && <p className="text-[13px] font-semibold text-muted-foreground mb-1">{authorName}</p>}

            {/* Editor */}
            <div
              data-inline-edit
              className="flex-1 min-h-0 overflow-y-auto [&_.tiptap]:!pt-0 [&_.tiptap_p]:!leading-relaxed [&_.tiptap]:max-h-none [&_.tiptap]:min-h-full"
            >
              <RichEditor
                ref={setRichEditorHandle}
                value={contentJson}
                onChange={setContentJson}
                onSubmit={handleSubmit}
                placeholder="Edit message..."
                ariaLabel="Edit message"
                ariaDescribedBy={instructionsId}
                messageSendMode="cmdEnter"
                autoFocus
                disableSelectionToolbar
                blurOnEscape
                onEscapeBlur={focusMobileActionBar}
              />
            </div>
          </div>

          {/* Action bar + toolbar at the bottom of the drawer */}
          <div
            ref={mobileActionBarRef}
            className="px-4 pb-[max(8px,env(safe-area-inset-bottom))]"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
          >
            <EditorActionBar
              editorHandle={richEditorRef.current}
              disabled={isSaving}
              formatOpen={formatOpen}
              onFormatOpenChange={setFormatOpen}
              mobileExpanded={mobileExpanded}
              onMobileExpandedChange={setMobileExpanded}
              showAttach={false}
              trailingContent={trailingContent}
            />
            {formatOpen && (
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
        </DrawerContent>
      </Drawer>
    )
  }

  // Desktop layout — unchanged
  return (
    <>
      <p id={instructionsId} className="sr-only">
        {screenReaderInstructions}
      </p>
      <div data-inline-edit className="[&_.tiptap]:!pt-0 [&_.tiptap_p]:!leading-relaxed">
        <RichEditor
          value={contentJson}
          onChange={setContentJson}
          onSubmit={handleSubmit}
          placeholder="Edit message..."
          ariaLabel="Edit message"
          ariaDescribedBy={instructionsId}
          autoFocus
        />
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[11px] text-muted-foreground/70 hidden sm:flex items-center gap-1.5 mr-auto">
          <kbd className="kbd-hint">Esc</kbd> cancel
          <span className="text-muted-foreground/30">·</span>
          <kbd className="kbd-hint">↵</kbd> save
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDocEditorOpen(true)}
              disabled={isSaving}
            >
              <Expand className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Expand editor</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button size="sm" className="h-6 px-2.5 text-xs" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
      <DocumentEditorModal
        open={docEditorOpen}
        onOpenChange={setDocEditorOpen}
        initialContent={serializeToMarkdown(contentJson)}
        onSend={handleDocEditorSend}
        onDismiss={handleDocEditorDismiss}
        streamName="edit"
      />
    </>
  )
}
