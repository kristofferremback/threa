import { useState } from "react"
import { X, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RichEditor } from "@/components/editor"
import { useStreamService, useMessageService } from "@/contexts"
import { StreamTypes } from "@threa/types"

interface ThreadDraftPanelProps {
  workspaceId: string
  parentStreamId: string
  parentMessageId: string
  initialContent?: string
  onClose: () => void
  onThreadCreated: (threadId: string) => void
}

export function ThreadDraftPanel({
  workspaceId,
  parentStreamId,
  parentMessageId,
  initialContent = "",
  onClose,
  onThreadCreated,
}: ThreadDraftPanelProps) {
  const [content, setContent] = useState(initialContent)
  const [isCreating, setIsCreating] = useState(false)
  const streamService = useStreamService()
  const messageService = useMessageService()

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed || isCreating) return

    setIsCreating(true)
    try {
      // Create the thread
      const thread = await streamService.create(workspaceId, {
        type: StreamTypes.THREAD,
        parentStreamId,
        parentMessageId,
      })

      // Send the first message
      await messageService.create(workspaceId, thread.id, {
        streamId: thread.id,
        content: trimmed,
        contentFormat: "markdown",
      })

      // Transition to the real thread panel
      onThreadCreated(thread.id)
    } catch (error) {
      console.error("Failed to create thread:", error)
      setIsCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <h2 className="font-semibold">New thread</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>
      <main className="flex flex-1 flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Start a new thread</p>
          </div>
        </div>
        <div className="p-4 border-t">
          <div className="flex items-end gap-2">
            <RichEditor
              value={content}
              onChange={setContent}
              onSubmit={handleSubmit}
              placeholder="Write your reply..."
              disabled={isCreating}
            />
            <Button onClick={handleSubmit} disabled={!content.trim() || isCreating} size="sm" className="shrink-0">
              {isCreating ? "Creating..." : "Reply"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
