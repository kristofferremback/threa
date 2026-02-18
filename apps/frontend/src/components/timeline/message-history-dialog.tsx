import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { messagesApi, messageKeys } from "@/api/messages"
import { cn } from "@/lib/utils"
import type { MessageVersion } from "@threa/types"

interface MessageHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  messageId: string
  workspaceId: string
  currentContent: {
    contentMarkdown: string
    editedAt?: string
  }
}

interface RevisionEntry {
  revisionNumber: number
  isCurrent: boolean
  contentMarkdown: string
  timestamp?: string
}

export function MessageHistoryDialog({
  open,
  onOpenChange,
  messageId,
  workspaceId,
  currentContent,
}: MessageHistoryDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [messageId])

  const { data: versions = [] } = useQuery({
    queryKey: messageKeys.versions(messageId),
    queryFn: () => messagesApi.getVersions(workspaceId, messageId),
    enabled: open,
  })

  const revisions: RevisionEntry[] = buildRevisionList(versions, currentContent)
  const selected = revisions[selectedIndex] ?? revisions[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit history</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          <div className="w-48 shrink-0 border-r pr-4 overflow-y-auto">
            {revisions.map((rev, i) => (
              <button
                key={rev.revisionNumber}
                onClick={() => setSelectedIndex(i)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted text-muted-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">Revision {rev.revisionNumber}</span>
                  {rev.isCurrent && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Current
                    </Badge>
                  )}
                </div>
                {rev.timestamp && (
                  <div className="text-xs mt-0.5">
                    <RelativeTime date={rev.timestamp} />
                  </div>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {selected && <MarkdownContent content={selected.contentMarkdown} className="text-sm leading-relaxed" />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function buildRevisionList(
  versions: MessageVersion[],
  currentContent: { contentMarkdown: string; editedAt?: string }
): RevisionEntry[] {
  const currentRevisionNumber = versions.length + 1

  const revisions: RevisionEntry[] = []

  // Current version at top
  revisions.push({
    revisionNumber: currentRevisionNumber,
    isCurrent: true,
    contentMarkdown: currentContent.contentMarkdown,
    timestamp: currentContent.editedAt,
  })

  // Previous versions in reverse order (newest first)
  const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)
  for (const version of sorted) {
    revisions.push({
      revisionNumber: version.versionNumber,
      isCurrent: false,
      contentMarkdown: version.contentMarkdown,
      timestamp: version.createdAt,
    })
  }

  return revisions
}
