import { useState, useEffect, useRef, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Message, MessageMention } from "../types"

interface UseChatOptions {
  workspaceId: string
  channelId?: string
  threadId?: string
  enabled?: boolean
}

interface UseChatReturn {
  messages: Message[]
  rootMessage: Message | null
  ancestors: Message[]
  conversationId: string | null
  lastReadMessageId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMoreMessages: boolean
  isConnected: boolean
  connectionError: string | null
  isSending: boolean
  currentUserId: string | null
  sendMessage: (content: string, mentions?: MessageMention[]) => Promise<void>
  editMessage: (messageId: string, newContent: string) => Promise<void>
  loadMoreMessages: () => Promise<void>
  setLastReadMessageId: (messageId: string | null) => void
  markAllAsRead: () => Promise<void>
}

// Helper to build room names with workspace prefix
const room = {
  channel: (workspaceId: string, channelId: string) => `ws:${workspaceId}:chan:${channelId}`,
  conversation: (workspaceId: string, conversationId: string) => `ws:${workspaceId}:conv:${conversationId}`,
  thread: (workspaceId: string, messageId: string) => `ws:${workspaceId}:thread:${messageId}`,
}

const MESSAGE_PAGE_SIZE = 50

export function useChat({ workspaceId, channelId, threadId, enabled = true }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [rootMessage, setRootMessage] = useState<Message | null>(null)
  const [ancestors, setAncestors] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [lastReadMessageId, setLastReadMessageId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
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
    setHasMoreMessages(true)

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
            socket.emit("join", room.conversation(workspaceId, data.conversationId))
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

    // Handle read cursor updates (multi-device sync)
    socket.on(
      "readCursorUpdated",
      (data: { type: string; channelId?: string; conversationId?: string; messageId: string }) => {
        const { threadId: currentThreadId, channelId: currentChannelId } = currentViewRef.current

        // Check if this update is for the current view
        if (currentThreadId && data.conversationId) {
          // We're viewing a thread - update if it matches
          // Note: We'd need to track conversation ID to channel mapping
          setLastReadMessageId(data.messageId)
        } else if (currentChannelId && data.channelId === currentChannelId) {
          // We're viewing a channel - update if it matches
          setLastReadMessageId(data.messageId)
        }
      },
    )

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

    // Function to subscribe and fetch data
    const subscribeAndFetch = async () => {
      if (threadId) {
        // Subscribe to thread room FIRST (to catch any messages during fetch)
        socket.emit("join", room.thread(workspaceId, threadId))
        await fetchThreadData()
      } else if (channelId) {
        // Subscribe to channel room FIRST
        socket.emit("join", room.channel(workspaceId, channelId))
        await fetchChannelMessages()
      } else {
        setIsLoading(false)
      }
    }

    const fetchChannelMessages = async () => {
      try {
        const res = await fetch(
          `/api/workspace/${workspaceId}/channels/${channelId}/messages?limit=${MESSAGE_PAGE_SIZE}`,
          {
            credentials: "include",
          },
        )
        if (!res.ok) throw new Error("Failed to fetch messages")
        const data = await res.json()

        // Set the last read message ID from server
        if (data.lastReadMessageId) {
          setLastReadMessageId(data.lastReadMessageId)
        }

        // Check if there are more messages to load
        setHasMoreMessages(data.messages.length >= MESSAGE_PAGE_SIZE)

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
          socket.emit("join", room.conversation(workspaceId, data.conversationId))
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
            replyCount: r.replyCount || 0,
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
      console.log("[useChat] Socket already connected, subscribing now")
      subscribeAndFetch()
    } else {
      console.log("[useChat] Socket not yet connected, waiting for connect event")
      socket.once("connect", () => {
        console.log("[useChat] Socket connected, subscribing now")
        subscribeAndFetch()
      })
    }

    // Cleanup
    return () => {
      if (socket.connected) {
        if (threadId) {
          socket.emit("leave", room.thread(workspaceId, threadId))
          if (conversationIdRef.current) {
            socket.emit("leave", room.conversation(workspaceId, conversationIdRef.current))
          }
        } else if (channelId) {
          socket.emit("leave", room.channel(workspaceId, channelId))
        }
      }
      socket.disconnect()
    }
  }, [enabled, workspaceId, channelId, threadId])

  // Send message action
  const sendMessage = useCallback(
    async (content: string, mentions?: MessageMention[]) => {
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
            mentions: mentions || [],
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
          socketRef.current?.emit("join", room.conversation(workspaceId, sentMessage.conversationId))
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

  // Load more (older) messages
  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMoreMessages || messages.length === 0) return

    setIsLoadingMore(true)

    try {
      const offset = messages.length
      let url: string

      if (threadId) {
        url = `/api/workspace/${workspaceId}/threads/${threadId}?offset=${offset}&limit=${MESSAGE_PAGE_SIZE}`
      } else if (channelId) {
        url = `/api/workspace/${workspaceId}/channels/${channelId}/messages?offset=${offset}&limit=${MESSAGE_PAGE_SIZE}`
      } else {
        return
      }

      const res = await fetch(url, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to fetch older messages")
      const data = await res.json()

      const olderMessages: Message[] = threadId
        ? (data.replies || []).map((r: any) => ({
            id: r.id,
            userId: r.author_id,
            email: r.email || "unknown",
            message: r.content,
            timestamp: r.created_at,
            channelId: r.channel_id,
            conversationId: r.conversation_id,
            replyToMessageId: r.reply_to_message_id,
            isEdited: r.isEdited,
            replyCount: r.replyCount || 0,
          }))
        : data.messages || []

      // Check if there are more messages
      setHasMoreMessages(olderMessages.length >= MESSAGE_PAGE_SIZE)

      // Prepend older messages
      setMessages((prev) => {
        const allMessages = [...olderMessages, ...prev]
        const unique = allMessages.filter((msg, idx, arr) => arr.findIndex((m) => m.id === msg.id) === idx)
        return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      })
    } catch (error) {
      console.error("Failed to load more messages:", error)
      toast.error("Failed to load older messages")
    } finally {
      setIsLoadingMore(false)
    }
  }, [workspaceId, channelId, threadId, messages.length, isLoadingMore, hasMoreMessages])

  return {
    messages,
    rootMessage,
    ancestors,
    conversationId,
    lastReadMessageId,
    isLoading,
    isLoadingMore,
    hasMoreMessages,
    isConnected,
    connectionError,
    isSending,
    currentUserId,
    sendMessage,
    editMessage,
    loadMoreMessages,
    setLastReadMessageId,
    markAllAsRead,
  }
}
