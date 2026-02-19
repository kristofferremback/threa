import { useState, useEffect, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Expand } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RichEditor, DocumentEditorModal } from "@/components/editor"
import { useMessageService } from "@/contexts"
import { messageKeys } from "@/api/messages"
import { serializeToMarkdown, parseMarkdown } from "@threa/prosemirror"
import type { JSONContent } from "@threa/types"

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

interface MessageEditFormProps {
  messageId: string
  workspaceId: string
  initialContentJson?: JSONContent
  onSave: () => void
  onCancel: () => void
}

export function MessageEditForm({
  messageId,
  workspaceId,
  initialContentJson,
  onSave,
  onCancel,
}: MessageEditFormProps) {
  const queryClient = useQueryClient()
  const messageService = useMessageService()
  const [contentJson, setContentJson] = useState<JSONContent>(initialContentJson ?? EMPTY_DOC)
  const [isSaving, setIsSaving] = useState(false)
  const [docEditorOpen, setDocEditorOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

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
    if (!contentMarkdown.trim()) return
    await saveEdit(contentJson, contentMarkdown)
  }, [contentJson, saveEdit])

  const handleDocEditorSend = useCallback(
    async (markdown: string) => {
      const trimmed = markdown.trim()
      if (!trimmed) return
      setDocEditorOpen(false)
      await saveEdit(parseMarkdown(trimmed), trimmed)
    },
    [saveEdit]
  )

  const handleDocEditorDismiss = useCallback((markdown: string) => {
    const json = parseMarkdown(markdown)
    setContentJson(json)
  }, [])

  return (
    <>
      <div data-inline-edit className="[&_.tiptap]:!pt-0 [&_.tiptap_p]:!leading-relaxed">
        <RichEditor
          value={contentJson}
          onChange={setContentJson}
          onSubmit={handleSubmit}
          placeholder="Edit message..."
          autoFocus
        />
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5 mr-auto">
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
