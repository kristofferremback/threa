import { useState, useEffect, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Expand } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RichEditor, DocumentEditorModal } from "@/components/editor"
import { messagesApi } from "@/api/messages"
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

  const handleSubmit = useCallback(async () => {
    const contentMarkdown = serializeToMarkdown(contentJson)
    if (!contentMarkdown.trim()) return

    setIsSaving(true)
    try {
      await messagesApi.update(workspaceId, messageId, { contentJson, contentMarkdown })
      queryClient.invalidateQueries({ queryKey: ["messageVersions", messageId] })
      onSave()
    } catch {
      toast.error("Failed to save edit")
    } finally {
      setIsSaving(false)
    }
  }, [contentJson, workspaceId, messageId, onSave, queryClient])

  const handleDocEditorSend = useCallback(
    async (markdown: string) => {
      const trimmed = markdown.trim()
      if (!trimmed) return

      const json = parseMarkdown(trimmed)
      setIsSaving(true)
      try {
        await messagesApi.update(workspaceId, messageId, { contentJson: json, contentMarkdown: trimmed })
        queryClient.invalidateQueries({ queryKey: ["messageVersions", messageId] })
        setDocEditorOpen(false)
        onSave()
      } catch {
        toast.error("Failed to save edit")
      } finally {
        setIsSaving(false)
      }
    },
    [workspaceId, messageId, onSave, queryClient]
  )

  const handleDocEditorDismiss = useCallback((markdown: string) => {
    const json = parseMarkdown(markdown)
    setContentJson(json)
  }, [])

  return (
    <>
      <div className="rounded-md border bg-background">
        <RichEditor
          value={contentJson}
          onChange={setContentJson}
          onSubmit={handleSubmit}
          placeholder="Edit message..."
          autoFocus
          className="px-3"
        />
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t">
          <span className="text-xs text-muted-foreground mr-auto">Escape to cancel · Enter to save</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setDocEditorOpen(true)}
                disabled={isSaving}
              >
                <Expand className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Expand editor</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
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
