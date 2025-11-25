import { useState, useEffect } from "react"
import { format } from "date-fns"
import { History, X } from "lucide-react"
import { Modal, Spinner, Avatar, RelativeTime } from "../ui"

interface Revision {
  id: string
  content: string
  created_at: string
}

interface MessageRevisionsModalProps {
  isOpen: boolean
  onClose: () => void
  messageId: string
  currentContent: string
  authorEmail: string
  workspaceId: string
}

export function MessageRevisionsModal({
  isOpen,
  onClose,
  messageId,
  currentContent,
  authorEmail,
  workspaceId,
}: MessageRevisionsModalProps) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const fetchRevisions = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/messages/${messageId}/revisions`, {
          credentials: "include",
        })
        if (!res.ok) throw new Error("Failed to fetch revisions")
        const data = await res.json()
        setRevisions(data.revisions || [])
        setSelectedId("current")
      } catch (error) {
        console.error("Failed to fetch revisions:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRevisions()
  }, [isOpen, messageId, workspaceId])

  const allVersions = [
    { id: "current", content: currentContent, created_at: new Date().toISOString(), isCurrent: true },
    ...revisions.map((r) => ({ ...r, isCurrent: false })),
  ]

  const selectedVersion = allVersions.find((v) => v.id === selectedId) || allVersions[0]

  const getPreview = (content: string, maxLength = 80) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + "..."
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="flex flex-col h-[70vh] min-h-[500px]">
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-3">
            <History className="h-5 w-5" style={{ color: "var(--text-muted)" }} />
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              Message History
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size="md" />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            <div
              className="w-80 flex-shrink-0 overflow-y-auto"
              style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--bg-tertiary)" }}
            >
              <div className="p-3">
                <div
                  className="px-3 py-2 text-xs font-medium uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {allVersions.length} {allVersions.length === 1 ? "version" : "versions"}
                </div>
                {allVersions.map((version, index) => {
                  const isSelected = selectedId === version.id
                  return (
                    <button
                      key={version.id}
                      onClick={() => setSelectedId(version.id)}
                      className="w-full text-left px-4 py-4 rounded-lg mb-2 transition-colors"
                      style={{
                        background: isSelected ? "var(--hover-overlay-strong)" : "transparent",
                        borderLeft: isSelected ? "3px solid var(--accent-primary)" : "3px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "var(--hover-overlay)"
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "transparent"
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        {version.isCurrent ? (
                          <span
                            className="text-xs px-2 py-1 rounded font-medium text-white"
                            style={{ background: "var(--accent-secondary)" }}
                          >
                            Current
                          </span>
                        ) : (
                          <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                            Version {allVersions.length - index}
                          </span>
                        )}
                      </div>
                      <RelativeTime
                        date={version.created_at}
                        className="text-xs mb-2 block"
                        style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                      />
                      <div
                        className="text-sm line-clamp-2"
                        style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}
                      >
                        {getPreview(version.content)}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <div className="p-8 flex-1 overflow-y-auto">
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-1">
                    <Avatar name={authorEmail} size="md" />
                    <div>
                      <div className="text-base font-medium" style={{ color: "var(--text-primary)" }}>
                        {authorEmail}
                      </div>
                      <div className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {format(new Date(selectedVersion.created_at), "MMMM d, yyyy 'at' h:mm a")}
                      </div>
                    </div>
                    {selectedVersion.isCurrent && (
                      <span
                        className="text-xs px-2 py-1 rounded ml-auto"
                        style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
                      >
                        Current version
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className="text-base leading-relaxed whitespace-pre-wrap p-6 rounded-xl"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                >
                  {selectedVersion.content}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
