import { useState, useEffect, useRef, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Message } from "../types"

interface UseChatOptions {
  workspaceId: string
  channelId?: string
  threadId?: string
  enabled?: boolean
  onChannelRemoved?: (channelId: string, channelName: string) => void
}

interface UseChatReturn {
  messages: Message[]
  rootMessage: Message | null
  ancestors: Message[]
  conversationId: string | null
  lastReadMessageId: string | null
  isLoading: boolean
  isConnected: boolean
  connectionError: string | null
  isSending: boolean
  currentUserId: string | null
  sendMessage: (content: string) => Promise<void>
  editMessage: (messageId: string, newContent: string) => Promise<void>
  setLastReadMessageId: (messageId: string | null) => void
  markAllAsRead: () => Promise<void>
}

export function useChat({
  workspaceId,
  channelId,
  threadId,
  enabled = true,
  onChannelRemoved,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [rootMessage, setRootMessage] = useState<Message | null>(null)
  const [ancestors, setAncestors] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [lastReadMessageId, setLastReadMessageId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const socketRef = useRef<Socket | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  const currentViewRef = useRef<{ threadId?: string; channelId?: string }>({})

  // Keep refs in sync
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  useEffect(() => {
    currentViewRef.current = { threadId, channelId }
  }, [threadId, channelId])

  // Main socket and data effect
  useEffect(() => {
    if (!enabled) return

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    // Reset state when view changes
    setMessages([])
    setRootMessage(null)
    setAncestors([])
    setConversationId(null)
    setLastReadMessageId(null)
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

    // Handle message edits
    socket.on("messageEdited", (data: { id: string; content: string; updatedAt: string }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.id ? { ...msg, message: data.content, isEdited: true, updatedAt: data.updatedAt } : msg,
        ),
      )
      // Also update root message if it was edited
      setRootMessage((prev) =>
        prev?.id === data.id ? { ...prev, message: data.content, isEdited: true, updatedAt: data.updatedAt } : prev,
      )
    })

    // Get current user ID from socket auth
    socket.on("authenticated", (data: { userId: string }) => {
      setCurrentUserId(data.userId)
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

    // Handle being removed from a channel
    socket.on("channelMemberRemoved", (data: { channelId: string; channelName: string; removedByUserId?: string }) => {
      toast.error(`You were removed from #${data.channelName.replace("#", "")}`)
      onChannelRemoved?.(data.channelId, data.channelName)
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

        // Set the last read message ID from server
        if (data.lastReadMessageId) {
          setLastReadMessageId(data.lastReadMessageId)
        }

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
            isEdited: data.rootMessage.isEdited,
          }
          setRootMessage(rootMsg)
        }

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
              isEdited: a.isEdited,
            })),
          )
        }

        if (data.conversationId) {
          setConversationId(data.conversationId)
          socket.emit("join", `conv:${data.conversationId}`)
        }

        // Set the last read message ID from server
        if (data.lastReadMessageId) {
          setLastReadMessageId(data.lastReadMessageId)
        }

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
            isEdited: r.isEdited,
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
  }, [enabled, workspaceId, channelId, threadId])

  // Send message action
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending) return

      setIsSending(true)

      try {
        const response = await fetch(`/api/workspace/${workspaceId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            content: content.trim(),
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
        toast.error(error instanceof Error ? error.message : "Failed to send message")
        throw error
      } finally {
        setIsSending(false)
      }
    },
    [workspaceId, channelId, threadId, isSending],
  )

  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (!newContent.trim()) return

      try {
        const response = await fetch(`/api/workspace/${workspaceId}/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: newContent.trim() }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to edit message")
        }

        const updatedMessage = await response.json()

        // Optimistically update local state
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? { ...msg, message: updatedMessage.message, isEdited: true, updatedAt: updatedMessage.updatedAt }
              : msg,
          ),
        )

        // Also update root message if it was edited
        setRootMessage((prev) =>
          prev?.id === messageId
            ? { ...prev, message: updatedMessage.message, isEdited: true, updatedAt: updatedMessage.updatedAt }
            : prev,
        )
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to edit message")
        throw error
      }
    },
    [workspaceId],
  )

  const markAllAsRead = useCallback(async () => {
    if (messages.length === 0) return

    // Get the last message in the list
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) return

    try {
      const endpoint = conversationIdRef.current
        ? `/api/workspace/${workspaceId}/conversations/${conversationIdRef.current}/read`
        : `/api/workspace/${workspaceId}/channels/${channelId}/read`

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messageId: lastMessage.id }),
      })

      // Update local state
      setLastReadMessageId(lastMessage.id)
    } catch (error) {
      console.error("Failed to mark all as read:", error)
      toast.error("Failed to mark all as read")
    }
  }, [workspaceId, channelId, messages])

  return {
    messages,
    rootMessage,
    ancestors,
    conversationId,
    lastReadMessageId,
    isLoading,
    isConnected,
    connectionError,
    isSending,
    currentUserId,
    sendMessage,
    editMessage,
    setLastReadMessageId,
    markAllAsRead,
  }
}
