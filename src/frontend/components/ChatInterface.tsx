import { useState, useEffect, useRef } from "react"
import { io, Socket } from "socket.io-client"
import { formatDistanceToNow } from "date-fns"
import { Send, MessageCircle, ChevronRight, ChevronDown } from "lucide-react"
import { useAuth } from "../auth"
import { toast } from "sonner"

interface Message {
  id: string
  userId?: string
  email: string
  message: string
  timestamp: string
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
  channelId?: string
  threadId?: string // This is the ID of the message we are replying to / viewing as root
  title?: string
  onOpenThread?: (messageId: string) => void
}

export function ChatInterface({ channelId, threadId, title, onOpenThread }: ChatInterfaceProps) {
  const { isAuthenticated } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [rootMessage, setRootMessage] = useState<Message | null>(null)
  const [ancestors, setAncestors] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isContextExpanded, setIsContextExpanded] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("ChatInterface render", { isAuthenticated, channelId, threadId, isConnected, connectionError })

  // Connect to Socket.IO
  useEffect(() => {
    if (!isAuthenticated) {
      console.log("ChatInterface: Not authenticated, skipping socket connection")
      return
    }

    console.log("ChatInterface: Connecting socket", { channelId, threadId, isAuthenticated })

    const socket = io({
      withCredentials: true,
    })

    socketRef.current = socket

    socket.on("connect", () => {
      console.log("ChatInterface: Socket connected")
      setIsConnected(true)

      // Join appropriate rooms on connection
      if (threadId) {
        socket.emit("join", `thread:${threadId}`)
        // We also load the thread data, which might give us a conversationId to join
        socket.emit("loadThread", { messageId: threadId })
      } else if (channelId) {
        console.log("ChatInterface: Joining channel", channelId)
        socket.emit("join", `channel:${channelId}`)
      } else {
        console.warn("ChatInterface: No channelId or threadId provided")
      }
    })

    socket.on("messages", (data) => {
      // This is the "channel view" initial load (sent on connection by server default logic)
      // We might want to disable that default logic in the future, but for now:
      if (!threadId) {
        setMessages(data)
      }
    })

    socket.on("threadMessages", (data: ThreadData) => {
      if (data.rootMessageId === threadId) {
        // Separate root message from replies
        const root = data.messages.find((m) => m.id === threadId) || null
        const replies = data.messages.filter((m) => m.id !== threadId)

        setRootMessage(root)
        setMessages(replies)
        setAncestors(data.ancestors || [])

        // If we have a conversation ID, join that room too
        if (data.conversationId) {
          socket.emit("join", `conversation:${data.conversationId}`)
        }
      }
    })

    socket.on("message", (data: Message) => {
      // Handle incoming real-time messages
      if (threadId) {
        // In thread view:
        // 1. If message belongs to this conversation (if we have one)
        // 2. OR if message is a direct reply to our root message (creating the conversation now)
        const isReplyToRoot = data.replyToMessageId === threadId
        const isInConversation = rootMessage?.conversationId && data.conversationId === rootMessage.conversationId

        if (isReplyToRoot || isInConversation) {
          // Deduplicate messages (simple check by ID)
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.id)) return prev
            return [...prev, data]
          })

          // Update root message conversationId if it was just created
          if (isReplyToRoot && !rootMessage?.conversationId && data.conversationId) {
            setRootMessage((prev) => (prev ? { ...prev, conversationId: data.conversationId } : null))
            // And join the new conversation room!
            socket.emit("join", `conversation:${data.conversationId}`)
          }
        }
      } else {
        // In channel view:
        // Deduplicate
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev
          return [...prev, data]
        })
      }
    })

    socket.on("disconnect", () => {
      console.log("ChatInterface: Socket disconnected")
      setIsConnected(false)
    })
    socket.on("error", (err: { message?: string }) => {
      console.error("ChatInterface: Socket error", err)
      const errorMessage = err.message || "Connection error"
      setConnectionError(errorMessage)
      setIsConnected(false)
      toast.error(errorMessage)
    })
    socket.on("connect_error", (err) => {
      console.error("ChatInterface: Socket connection error", err)
      toast.error("Failed to connect to server")
    })

    return () => {
      // Cleanup rooms on unmount
      if (socketRef.current?.connected) {
        if (threadId) {
          socketRef.current.emit("leave", `thread:${threadId}`)
          if (rootMessage?.conversationId) {
            socketRef.current.emit("leave", `conversation:${rootMessage.conversationId}`)
          }
        } else if (channelId) {
          socketRef.current.emit("leave", `channel:${channelId}`)
        }
      }
      socket.disconnect()
    }
  }, [isAuthenticated, channelId, threadId]) // Re-run when threadId changes

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputMessage.trim() || !socketRef.current?.connected) return

    if (threadId) {
      // Reply in thread
      socketRef.current.emit("message", {
        message: inputMessage,
        channelId,
        replyToMessageId: threadId,
        conversationId: rootMessage?.conversationId, // Pass if known
      })
    } else {
      // Standard channel message - include channelId so server knows which channel
      socketRef.current.emit("message", {
        message: inputMessage,
        channelId,
      })
    }

    setInputMessage("")
  }

  // Always render something - even if not connected
  if (!isAuthenticated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-white">
        <div className="text-center text-zinc-500">
          <p>Please log in to continue</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full flex-col bg-zinc-950 font-sans text-white relative"
      style={{ minHeight: "100%" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 p-4 bg-zinc-950 flex-shrink-0">
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-blue-500" />
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold">{title || "General"}</h2>
            {threadId && <span className="text-xs text-zinc-500">Thread View</span>}
          </div>
        </div>
        <div className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
      </div>

      {/* Thread Context Area */}
      {threadId && (
        <div className="bg-zinc-900/50 border-b border-zinc-800">
          {/* Collapsible Ancestors */}
          {ancestors.length > 0 && (
            <div className="border-b border-zinc-800/50">
              <button
                onClick={() => setIsContextExpanded(!isContextExpanded)}
                className="flex items-center gap-2 w-full px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
              >
                {isContextExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {isContextExpanded ? "Hide context" : `Show ${ancestors.length} parent messages`}
              </button>

              {isContextExpanded && (
                <div className="px-4 pb-2 space-y-3">
                  {ancestors.map((parent) => (
                    <div key={parent.id} className="flex gap-3 pl-2 border-l-2 border-zinc-700/50 opacity-75">
                      <div className="flex-1">
                        <div className="flex items-baseline justify-between mb-0.5">
                          <span className="text-xs font-medium text-zinc-400">{parent.email}</span>
                          <span className="text-[10px] text-zinc-600">
                            {formatDistanceToNow(new Date(parent.timestamp), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-400">{parent.message}</p>
                        {/* Allow jumping to ancestor context */}
                        <button
                          onClick={() => onOpenThread?.(parent.id)}
                          className="text-[10px] text-blue-500 hover:underline mt-1"
                        >
                          View thread
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Immediate Parent (Root of this view) */}
          <div className="p-4 bg-zinc-900">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">Parent</span>
            </div>
            {rootMessage ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{rootMessage.email}</span>
                  <span className="text-xs text-zinc-500">
                    {formatDistanceToNow(new Date(rootMessage.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-gray-100">{rootMessage.message}</p>
              </div>
            ) : (
              <div className="text-sm text-zinc-500 animate-pulse">Loading parent message...</div>
            )}
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {(!isConnected || connectionError) && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-zinc-400 max-w-md px-4">
              <MessageCircle className="h-16 w-16 mx-auto mb-4 text-zinc-700" />
              <h3 className="text-lg font-semibold mb-2 text-zinc-300">Not connected to workspace</h3>
              {connectionError && (
                <p className="text-sm text-zinc-500 mb-2 font-mono text-xs bg-zinc-900 p-2 rounded">
                  {connectionError}
                </p>
              )}
              <p className="text-sm text-zinc-500 mb-4">
                You may not be a member of any workspace yet. Please contact your administrator to be added to a
                workspace.
              </p>
            </div>
          </div>
        )}

        {isConnected && threadId && messages.length === 0 && rootMessage && (
          <div className="text-center text-zinc-500 text-sm mt-4">No replies yet</div>
        )}

        {isConnected && messages.length === 0 && !threadId && (
          <div className="text-center text-zinc-500 text-sm mt-4">No messages yet. Start chatting!</div>
        )}

        {isConnected &&
          messages.map((msg) => (
            <div
              key={msg.id || msg.timestamp}
              className="group mb-3 rounded-lg hover:bg-zinc-900/50 p-2 -mx-2 transition-colors"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-300">{msg.email}</span>
                <span className="text-xs text-zinc-500">
                  {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
                </span>
              </div>
              <div className="text-sm text-zinc-300 leading-relaxed">{msg.message}</div>

              <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button
                  onClick={() => onOpenThread?.(msg.id)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <MessageCircle className="h-3 w-3" />
                  Reply in thread
                </button>
              </div>
            </div>
          ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-800 bg-zinc-950 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={threadId ? "Reply to thread..." : `Message ${title || "#general"}`}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() || !isConnected}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  )
}
