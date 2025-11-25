import { useState, useEffect, useRef, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Message } from "../types"

interface UseChatOptions {
  workspaceId: string
  channelId?: string
  threadId?: string
  enabled?: boolean
}

interface UseChatReturn {
  // State
  messages: Message[]
  rootMessage: Message | null
  ancestors: Message[]
  conversationId: string | null
  isLoading: boolean
  isConnected: boolean
  connectionError: string | null
  isSending: boolean

  // Actions
  sendMessage: (content: string) => Promise<void>
}

export function useChat({ workspaceId, channelId, threadId, enabled = true }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [rootMessage, setRootMessage] = useState<Message | null>(null)
  const [ancestors, setAncestors] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

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

  return {
    messages,
    rootMessage,
    ancestors,
    conversationId,
    isLoading,
    isConnected,
    connectionError,
    isSending,
    sendMessage,
  }
}

