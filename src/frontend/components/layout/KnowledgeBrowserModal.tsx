import { useState, useEffect } from "react"
import { X, Search, BookOpen, ExternalLink, Calendar, User, WifiOff, ChevronDown, ChevronUp, Hash, MessageSquare } from "lucide-react"
import { Modal } from "../ui/Modal"
import { Spinner } from "../ui/Spinner"
import { useOffline } from "../../contexts/OfflineContext"

interface Memo {
  id: string
  summary: string
  topics: string[]
  confidence: number
  retrievalCount: number
  source: "user" | "system" | "ariadne"
  createdAt: string
  contextStreamId: string | null
  streamName?: string | null
  anchorContent?: string | null
  authorName?: string | null
}

interface KnowledgeBrowserModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  onNavigateToStream?: (streamId: string) => void
}

export function KnowledgeBrowserModal({
  isOpen,
  onClose,
  workspaceId,
  onNavigateToStream,
}: KnowledgeBrowserModalProps) {
  const { isOnline } = useOffline()
  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [topicFilter, setTopicFilter] = useState<string | null>(null)

  // Fetch memos
  useEffect(() => {
    if (!isOpen || !workspaceId) return

    const fetchMemos = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: "50" })
        if (topicFilter) {
          params.set("topics", topicFilter)
        }

        const res = await fetch(`/api/workspace/${workspaceId}/memos?${params}`, {
          credentials: "include",
        })

        if (!res.ok) {
          throw new Error("Failed to fetch memos")
        }

        const data = await res.json()
        setMemos(data.memos || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load knowledge")
      } finally {
        setLoading(false)
      }
    }

    fetchMemos()
  }, [isOpen, workspaceId, topicFilter])

  // Filter memos by search query
  const filteredMemos = memos.filter((memo) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return memo.summary.toLowerCase().includes(query) || memo.topics.some((t) => t.toLowerCase().includes(query))
  })

  // Get all unique topics
  const allTopics = [...new Set(memos.flatMap((m) => m.topics))].sort()

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="flex flex-col h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Knowledge Base
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--hover-overlay)] transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search and filters */}
        <div className="p-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                type="text"
                placeholder="Search knowledge..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg text-sm"
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          {/* Topic filters */}
          {allTopics.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => setTopicFilter(null)}
                className="px-2 py-1 rounded text-xs font-medium transition-colors"
                style={{
                  background: topicFilter === null ? "var(--accent-primary)" : "var(--bg-tertiary)",
                  color: topicFilter === null ? "white" : "var(--text-secondary)",
                }}
              >
                All
              </button>
              {allTopics.slice(0, 10).map((topic) => (
                <button
                  key={topic}
                  onClick={() => setTopicFilter(topic === topicFilter ? null : topic)}
                  className="px-2 py-1 rounded text-xs font-medium transition-colors"
                  style={{
                    background: topicFilter === topic ? "var(--accent-primary)" : "var(--bg-tertiary)",
                    color: topicFilter === topic ? "white" : "var(--text-secondary)",
                  }}
                >
                  {topic}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!isOnline ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <WifiOff className="h-12 w-12 mb-3" style={{ color: "var(--text-muted)" }} />
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                You're offline
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                Knowledge browsing requires an internet connection
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p style={{ color: "var(--text-muted)" }}>{error}</p>
            </div>
          ) : filteredMemos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <BookOpen className="h-12 w-12 mb-3" style={{ color: "var(--text-muted)" }} />
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                No knowledge yet
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                Knowledge will be captured as your team has valuable conversations
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMemos.map((memo) => (
                <MemoCard
                  key={memo.id}
                  memo={memo}
                  onNavigate={
                    memo.contextStreamId && onNavigateToStream
                      ? () => onNavigateToStream(memo.contextStreamId!)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
        >
          {filteredMemos.length} {filteredMemos.length === 1 ? "memo" : "memos"}
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      </div>
    </Modal>
  )
}

interface MemoCardProps {
  memo: Memo
  onNavigate?: () => void
}

function MemoCard({ memo, onNavigate }: MemoCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasContent = Boolean(memo.anchorContent)

  const sourceLabel = {
    user: "Saved by user",
    system: "Auto-captured",
    ariadne: "From Ariadne",
  }[memo.source]

  const truncateContent = (content: string, maxLength: number = 300) => {
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength).trim() + "..."
  }

  return (
    <div
      className="rounded-lg border transition-colors overflow-hidden"
      style={{
        background: "var(--bg-tertiary)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>
              {memo.summary}
            </p>

            {memo.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {memo.topics.map((topic) => (
                  <span
                    key={topic}
                    className="px-2 py-0.5 rounded text-xs"
                    style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              {memo.authorName && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {memo.authorName}
                </span>
              )}
              {memo.streamName && (
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {memo.streamName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(memo.createdAt).toLocaleDateString()}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {sourceLabel}
              </span>
              {memo.retrievalCount > 0 && <span>Used {memo.retrievalCount}×</span>}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {hasContent && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-2 rounded-lg hover:bg-[var(--hover-overlay)] transition-colors"
                style={{ color: "var(--text-muted)" }}
                title={isExpanded ? "Hide content" : "Show content"}
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
            {onNavigate && (
              <button
                onClick={onNavigate}
                className="p-2 rounded-lg hover:bg-[var(--hover-overlay)] transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="View conversation"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {hasContent && isExpanded && (
        <div
          className="px-4 pb-4 pt-0"
        >
          <div
            className="p-3 rounded-lg text-sm whitespace-pre-wrap"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-secondary)",
              borderLeft: "3px solid var(--accent-primary)",
            }}
          >
            {truncateContent(memo.anchorContent!, 600)}
          </div>
          {memo.anchorContent && memo.anchorContent.length > 600 && onNavigate && (
            <button
              onClick={onNavigate}
              className="mt-2 text-xs hover:underline"
              style={{ color: "var(--accent-primary)" }}
            >
              View full conversation →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
