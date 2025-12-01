import { useState, useEffect, useMemo } from "react"
import { Hash, Lock, Users, Plus, Search, X, LogIn, Check } from "lucide-react"
import { clsx } from "clsx"
import type { Stream } from "../../types"

interface DiscoverableStream extends Stream {
  memberCount?: number
}

interface BrowseChannelsModalProps {
  open: boolean
  workspaceId: string
  onClose: () => void
  onJoinStream: (stream: Stream) => void
  onCreateChannel: () => void
}

export function BrowseChannelsModal({
  open,
  workspaceId,
  onClose,
  onJoinStream,
  onCreateChannel,
}: BrowseChannelsModalProps) {
  const [streams, setStreams] = useState<DiscoverableStream[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [joiningStreamId, setJoiningStreamId] = useState<string | null>(null)

  // Fetch discoverable streams when modal opens
  useEffect(() => {
    if (!open) return

    const fetchStreams = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/streams/browse`, {
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          setStreams(data.streams)
        } else {
          setError("Failed to load channels")
        }
      } catch (err) {
        setError("Failed to load channels")
        console.error("Failed to fetch discoverable streams:", err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStreams()
  }, [open, workspaceId])

  // Filter streams by search query
  const filteredStreams = useMemo(() => {
    if (!searchQuery) return streams

    const query = searchQuery.toLowerCase()
    return streams.filter(
      (stream) =>
        stream.name?.toLowerCase().includes(query) ||
        stream.slug?.toLowerCase().includes(query) ||
        stream.description?.toLowerCase().includes(query),
    )
  }, [streams, searchQuery])

  // Separate into joined and available
  const joinedStreams = filteredStreams.filter((s) => s.isMember)
  const availableStreams = filteredStreams.filter((s) => !s.isMember)

  const handleJoin = async (stream: DiscoverableStream) => {
    setJoiningStreamId(stream.id)
    try {
      await onJoinStream(stream)
      // Update local state
      setStreams((prev) => prev.map((s) => (s.id === stream.id ? { ...s, isMember: true } : s)))
    } finally {
      setJoiningStreamId(null)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        style={{ background: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
      >
        <div
          className="p-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Browse Channels
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
          >
            <Search className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search channels..."
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
              autoFocus
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} style={{ color: "var(--text-muted)" }}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div
                className="w-6 h-6 border-2 rounded-full animate-spin"
                style={{ borderColor: "var(--border-subtle)", borderTopColor: "var(--accent-primary)" }}
              />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: "var(--error)" }}>
                {error}
              </p>
            </div>
          ) : filteredStreams.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                {searchQuery ? "No channels match your search" : "No public channels available"}
              </p>
              <button
                onClick={onCreateChannel}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                style={{ background: "var(--accent-primary)", color: "white" }}
              >
                <Plus className="h-4 w-4" />
                Create a channel
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {availableStreams.length > 0 && (
                <div>
                  <h3
                    className="text-xs font-medium uppercase tracking-wider mb-2 px-1"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Available to join
                  </h3>
                  <div className="space-y-1">
                    {availableStreams.map((stream) => (
                      <ChannelRow
                        key={stream.id}
                        stream={stream}
                        isJoining={joiningStreamId === stream.id}
                        onJoin={() => handleJoin(stream)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {joinedStreams.length > 0 && (
                <div>
                  <h3
                    className="text-xs font-medium uppercase tracking-wider mb-2 px-1"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Already joined
                  </h3>
                  <div className="space-y-1">
                    {joinedStreams.map((stream) => (
                      <ChannelRow key={stream.id} stream={stream} isJoined />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <button
            onClick={onCreateChannel}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Plus className="h-4 w-4" />
            Create new channel
          </button>
        </div>
      </div>
    </div>
  )
}

interface ChannelRowProps {
  stream: DiscoverableStream
  isJoined?: boolean
  isJoining?: boolean
  onJoin?: () => void
}

function ChannelRow({ stream, isJoined, isJoining, onJoin }: ChannelRowProps) {
  const isPrivate = stream.visibility === "private"
  const Icon = isPrivate ? Lock : Hash

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg transition-colors"
      style={{ background: "var(--bg-tertiary)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "var(--bg-secondary)" }}
      >
        <Icon className="h-5 w-5" style={{ color: "var(--text-muted)" }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {stream.name}
          </span>
          {stream.memberCount !== undefined && (
            <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <Users className="h-3 w-3" />
              {stream.memberCount}
            </span>
          )}
        </div>
        {stream.description && (
          <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
            {stream.description}
          </p>
        )}
      </div>

      {isJoined ? (
        <span
          className="flex items-center gap-1 text-xs px-2 py-1 rounded"
          style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}
        >
          <Check className="h-3 w-3" />
          Joined
        </span>
      ) : (
        <button
          onClick={onJoin}
          disabled={isJoining}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--accent-primary)", color: "white" }}
        >
          {isJoining ? (
            <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <LogIn className="h-3 w-3" />
          )}
          Join
        </button>
      )}
    </div>
  )
}
