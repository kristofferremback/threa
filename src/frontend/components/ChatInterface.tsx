import { useState, useEffect, useRef } from "react"
import { io, Socket } from "socket.io-client"
import { formatDistanceToNow } from "date-fns"
import {
  Send,
  MessageCircle,
  ChevronRight,
  ChevronDown,
  Loader2,
  Hash,
  AlertCircle,
  PanelRightOpen,
} from "lucide-react"
import { useAuth } from "../auth"
import { toast } from "sonner"
import { clsx } from "clsx"

export type OpenMode = "replace" | "side" | "newTab"

interface Message {
  id: string
  userId?: string
  email: string
  message: string
  timestamp: string
  channelId: string
  replyCount?: number
  conversationId?: string | null
  replyToMessageId?: string | null
}

interface ThreadData {
  rootMessageId: string
  conversationId: string | null
  messages: Message[]
  ancestors: Message[]
}

interface ChatInterfaceProps {
  workspaceId: string
  channelId?: string
  threadId?: string
  title?: string
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
}

// Helper to determine open mode from mouse event
function getOpenMode(e: React.MouseEvent): OpenMode {
  // Cmd/Ctrl + Click = new browser tab
  if (e.metaKey || e.ctrlKey) return "newTab"
  // Alt/Option + Click = open to side
  if (e.altKey) return "side"
  // Regular click = replace current
  return "replace"
}

export function ChatInterface({ workspaceId, channelId, threadId, title, onOpenThread }: ChatInterfaceProps) {
  const { isAuthenticated } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [rootMessage, setRootMessage] = useState<Message | null>(null)
  const [ancestors, setAncestors] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null) // Track conversation separately
  const conversationIdRef = useRef<string | null>(null) // Ref for use in event handlers
  const [inputMessage, setInputMessage] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isContextExpanded, setIsContextExpanded] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Keep ref in sync with state
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // Loading state for initial fetch
  const [isLoading, setIsLoading] = useState(true)

  // Track current view for the message handler
  const currentViewRef = useRef<{ threadId?: string; channelId?: string }>({})
  useEffect(() => {
    currentViewRef.current = { threadId, channelId }
  }, [threadId, channelId])

  // Connect to Socket.IO, set up event handlers, and fetch data
  useEffect(() => {
    if (!isAuthenticated) return

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    // Reset state when view changes
    setMessages([])
    setRootMessage(null)
    setAncestors([])
    setConversationId(null)
    setIsLoading(true)

    socket.on("connect", () => {
      setIsConnected(true)
      setConnectionError(null)
    })

    // Handle incoming messages (real-time updates)
    socket.on("message", (data: Message) => {
      const { threadId: currentThreadId, channelId: currentChannelId } = currentViewRef.current

      if (currentThreadId) {
        // In thread view: show messages that are replies to the root
        const isReplyToRoot = data.replyToMessageId === currentThreadId

        if (isReplyToRoot) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.id)) return prev
            const newMessages = [...prev, data].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
            )
            return newMessages
          })

          // If this is the first reply, a conversation was just created - join it
          if (data.conversationId && !conversationIdRef.current) {
            setConversationId(data.conversationId)
            socket.emit("join", `conv:${data.conversationId}`)
          }
        }
      } else if (currentChannelId) {
        // In channel view: only show messages that are NOT replies
        if (data.replyToMessageId) {
          return
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev
          const newMessages = [...prev, data].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          )
          return newMessages
        })
      }
    })

    // Handle reply count updates
    socket.on("replyCountUpdate", (data: { messageId: string; replyCount: number }) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === data.messageId ? { ...msg, replyCount: data.replyCount } : msg)),
      )
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
    })

    socket.on("error", (err: { message?: string }) => {
      const errorMessage = err.message || "Connection error"
      setConnectionError(errorMessage)
      setIsConnected(false)
      toast.error(errorMessage)
    })

    socket.on("connect_error", () => {
      toast.error("Failed to connect to server")
    })

    // Function to subscribe and fetch data
    const subscribeAndFetch = async () => {
      if (threadId) {
        // Subscribe to thread room FIRST (to catch any messages during fetch)
        socket.emit("join", `thread:${threadId}`)
        await fetchThreadData()
      } else if (channelId) {
        // Subscribe to channel room FIRST
        socket.emit("join", `chan:${channelId}`)
        await fetchChannelMessages()
      } else {
        setIsLoading(false)
      }
    }

    const fetchChannelMessages = async () => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/channels/${channelId}/messages?limit=50`, {
          credentials: "include",
        })
        if (!res.ok) throw new Error("Failed to fetch messages")
        const data = await res.json()

        // Merge with any messages that arrived via socket during fetch
        setMessages((prev) => {
          const allMessages = [...data.messages, ...prev]
          const unique = allMessages.filter((msg, idx, arr) => arr.findIndex((m) => m.id === msg.id) === idx)
          return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        })
      } catch (error) {
        console.error("Failed to fetch channel messages:", error)
        toast.error("Failed to load messages")
      } finally {
        setIsLoading(false)
      }
    }

    const fetchThreadData = async () => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/threads/${threadId}`, {
          credentials: "include",
        })
        if (!res.ok) throw new Error("Failed to fetch thread")
        const data = await res.json()

        // Set root message
        if (data.rootMessage) {
          const rootMsg: Message = {
            id: data.rootMessage.id,
            userId: data.rootMessage.author_id,
            email: data.rootMessage.email || "unknown",
            message: data.rootMessage.content,
            timestamp: data.rootMessage.created_at,
            channelId: data.rootMessage.channel_id,
            conversationId: data.rootMessage.conversation_id,
            replyToMessageId: data.rootMessage.reply_to_message_id,
          }
          setRootMessage(rootMsg)
        }

        // Set ancestors
        if (data.ancestors) {
          setAncestors(
            data.ancestors.map((a: any) => ({
              id: a.id,
              userId: a.author_id,
              email: a.email || "unknown",
              message: a.content,
              timestamp: a.created_at,
              channelId: a.channel_id,
              conversationId: a.conversation_id,
              replyToMessageId: a.reply_to_message_id,
            })),
          )
        }

        // Set conversation ID and join room if exists
        if (data.conversationId) {
          setConversationId(data.conversationId)
          socket.emit("join", `conv:${data.conversationId}`)
        }

        // Merge replies with any that arrived via socket
        if (data.replies) {
          const replies: Message[] = data.replies.map((r: any) => ({
            id: r.id,
            userId: r.author_id,
            email: r.email || "unknown",
            message: r.content,
            timestamp: r.created_at,
            channelId: r.channel_id,
            conversationId: r.conversation_id,
            replyToMessageId: r.reply_to_message_id,
          }))

          setMessages((prev) => {
            const allMessages = [...replies, ...prev]
            const unique = allMessages.filter((msg, idx, arr) => arr.findIndex((m) => m.id === msg.id) === idx)
            return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          })
        }
      } catch (error) {
        console.error("Failed to fetch thread:", error)
        toast.error("Failed to load thread")
      } finally {
        setIsLoading(false)
      }
    }

    // Subscribe when socket is connected
    if (socket.connected) {
      subscribeAndFetch()
    } else {
      socket.once("connect", subscribeAndFetch)
    }

    // Cleanup
    return () => {
      if (socket.connected) {
        if (threadId) {
          socket.emit("leave", `thread:${threadId}`)
          if (conversationIdRef.current) {
            socket.emit("leave", `conv:${conversationIdRef.current}`)
          }
        } else if (channelId) {
          socket.emit("leave", `chan:${channelId}`)
        }
      }
      socket.disconnect()
    }
  }, [isAuthenticated, workspaceId, channelId, threadId])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const [isSending, setIsSending] = useState(false)

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputMessage.trim() || isSending) return

    const messageContent = inputMessage.trim()
    setInputMessage("") // Clear immediately for better UX
    setIsSending(true)

    try {
      const response = await fetch(`/api/workspace/${workspaceId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: messageContent,
          channelId,
          replyToMessageId: threadId || undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to send message")
      }

      const sentMessage = await response.json()

      // If this was a reply and we didn't have a conversation ID, we now do
      if (threadId && sentMessage.conversationId && !conversationIdRef.current) {
        setConversationId(sentMessage.conversationId)
        socketRef.current?.emit("join", `conv:${sentMessage.conversationId}`)
      }
    } catch (error) {
      // Restore the message on error
      setInputMessage(messageContent)
      toast.error(error instanceof Error ? error.message : "Failed to send message")
    } finally {
      setIsSending(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <p style={{ color: "var(--text-muted)" }}>Please log in to continue</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--bg-primary)", minHeight: "100%" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3">
          {threadId ? (
            <MessageCircle className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          ) : (
            <Hash className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          )}
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {title || "General"}
            </h2>
            {threadId && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Thread
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={clsx("h-2 w-2 rounded-full", isConnected ? "animate-pulse" : "")}
            style={{ background: isConnected ? "var(--success)" : "var(--danger)" }}
          />
          <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {isConnected ? "live" : "offline"}
          </span>
        </div>
      </div>

      {/* Thread Context Area */}
      {threadId && (
        <div style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>
          {/* Collapsible Ancestors */}
          {ancestors.length > 0 && (
            <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <button
                onClick={() => setIsContextExpanded(!isContextExpanded)}
                className="flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                {isContextExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {isContextExpanded ? "Hide context" : `Show ${ancestors.length} parent messages`}
              </button>

              {isContextExpanded && (
                <div className="px-4 pb-3 space-y-3">
                  {ancestors.map((parent) => (
                    <div
                      key={parent.id}
                      className="flex gap-3 pl-3 opacity-60"
                      style={{ borderLeft: "2px solid var(--border-default)" }}
                    >
                      <div className="flex-1">
                        <div className="flex items-baseline justify-between mb-0.5">
                          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                            {parent.email}
                          </span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {formatDistanceToNow(new Date(parent.timestamp), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                          {parent.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={(e) => onOpenThread?.(parent.id, parent.channelId, getOpenMode(e))}
                            className="text-xs hover:underline"
                            style={{ color: "var(--accent-primary)" }}
                            title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
                          >
                            View thread
                          </button>
                          <button
                            onClick={() => onOpenThread?.(parent.id, parent.channelId, "side")}
                            className="p-0.5 rounded hover:bg-white/5"
                            style={{ color: "var(--text-muted)" }}
                            title="Open thread to side"
                          >
                            <PanelRightOpen className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Root Message */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded"
                style={{ background: "var(--accent-glow)", color: "var(--accent-primary)" }}
              >
                Parent
              </span>
            </div>
            {rootMessage ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {rootMessage.email}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {formatDistanceToNow(new Date(rootMessage.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {rootMessage.message}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {/* Connection error state */}
        {connectionError && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-md px-4">
              <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--text-muted)" }} />
              <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                Connection Error
              </h3>
              <p
                className="text-sm mb-2 p-2 rounded"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {connectionError}
              </p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {!connectionError && isLoading && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" style={{ color: "var(--accent-primary)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Loading messages...
              </p>
            </div>
          </div>
        )}

        {/* Empty thread state */}
        {!connectionError && !isLoading && threadId && messages.length === 0 && rootMessage && (
          <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No replies yet. Start the conversation!</p>
          </div>
        )}

        {/* Empty channel state */}
        {!connectionError && !isLoading && messages.length === 0 && !threadId && (
          <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
            <Hash className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No messages yet. Say hello!</p>
          </div>
        )}

        {/* Messages */}
        {!isLoading &&
          messages.map((msg, idx) => (
            <div
              key={msg.id || msg.timestamp}
              className="group mb-1 rounded-lg p-3 -mx-2 transition-colors hover:bg-white/5 animate-fade-in"
              style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
            >
              <div className="mb-1 flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                >
                  {msg.email.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {msg.email}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
                </span>
              </div>
              <div className="pl-8 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {msg.message}
              </div>

              {/* Thread actions */}
              {msg.replyCount && msg.replyCount > 0 ? (
                <div className="pl-8 mt-2 flex items-center gap-2">
                  <button
                    onClick={(e) => onOpenThread?.(msg.id, msg.channelId, getOpenMode(e))}
                    className="text-xs flex items-center gap-1.5 transition-colors hover:underline"
                    style={{ color: "var(--accent-primary)" }}
                    title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span className="font-medium">
                      {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
                    </span>
                  </button>
                  <button
                    onClick={() => onOpenThread?.(msg.id, msg.channelId, "side")}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/5"
                    style={{ color: "var(--text-muted)" }}
                    title="Open thread to side"
                  >
                    <PanelRightOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="pl-8 mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                  <button
                    onClick={(e) => onOpenThread?.(msg.id, msg.channelId, getOpenMode(e))}
                    className="text-xs flex items-center gap-1 transition-colors hover:underline"
                    style={{ color: "var(--accent-primary)" }}
                    title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
                  >
                    <MessageCircle className="h-3 w-3" />
                    Reply in thread
                  </button>
                  <button
                    onClick={() => onOpenThread?.(msg.id, msg.channelId, "side")}
                    className="p-1 rounded hover:bg-white/5"
                    style={{ color: "var(--text-muted)" }}
                    title="Open thread to side"
                  >
                    <PanelRightOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSendMessage}
        className="p-4 flex-shrink-0"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={threadId ? "Reply to thread..." : `Message ${title || "#general"}`}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() || !isConnected || isSending}
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "var(--accent-secondary)",
              color: "white",
            }}
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  )
}
