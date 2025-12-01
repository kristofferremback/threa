/**
 * Stream API Client
 *
 * Platform-agnostic API client for stream operations.
 * Uses fetch API which works in browser, React Native, and Node.js.
 */

import type {
  Stream,
  StreamEvent,
  EventsResponse,
  PostMessageInput,
  PostMessageResponse,
  EditMessageInput,
  StreamResponse,
  CreateStreamInput,
  UpdateStreamInput,
} from "./types"

// Base URL is set by the environment
const getBaseUrl = () => {
  // In browser, use relative URLs
  if (typeof window !== "undefined") return ""
  // In Node.js/server, this would be configured differently
  return process.env.API_BASE_URL || ""
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message || `API Error: ${response.status}`)
  }
  return response.json()
}

export const streamApi = {
  /**
   * Get a stream with optional parent/root info (for threads)
   */
  async getStream(workspaceId: string, streamId: string): Promise<StreamResponse> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}`, {
      credentials: "include",
    })
    return handleResponse<StreamResponse>(response)
  },

  /**
   * Get events for a stream with pagination
   */
  async getEvents(
    workspaceId: string,
    streamId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<EventsResponse> {
    const params = new URLSearchParams()
    if (options.cursor) params.set("cursor", options.cursor)
    if (options.limit) params.set("limit", String(options.limit))

    const url = `${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/events${
      params.toString() ? `?${params}` : ""
    }`

    const response = await fetch(url, { credentials: "include" })
    return handleResponse<EventsResponse>(response)
  },

  /**
   * Post a message to a stream
   */
  async postMessage(workspaceId: string, streamId: string, data: PostMessageInput): Promise<PostMessageResponse> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    })
    return handleResponse<PostMessageResponse>(response)
  },

  /**
   * Edit an existing event
   */
  async editEvent(
    workspaceId: string,
    streamId: string,
    eventId: string,
    data: EditMessageInput,
  ): Promise<StreamEvent> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    })
    return handleResponse<StreamEvent>(response)
  },

  /**
   * Share an event to the parent stream
   */
  async shareEvent(workspaceId: string, streamId: string, eventId: string): Promise<StreamEvent> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/events/${eventId}/share`,
      {
        method: "POST",
        credentials: "include",
      },
    )
    return handleResponse<StreamEvent>(response)
  },

  /**
   * Create a new stream (channel or thinking space)
   */
  async createStream(workspaceId: string, data: CreateStreamInput): Promise<Stream> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    })
    return handleResponse<Stream>(response)
  },

  /**
   * Update stream details
   */
  async updateStream(workspaceId: string, streamId: string, data: UpdateStreamInput): Promise<Stream> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    })
    return handleResponse<Stream>(response)
  },

  /**
   * Join a stream
   */
  async joinStream(workspaceId: string, streamId: string): Promise<void> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/join`, {
      method: "POST",
      credentials: "include",
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.status}`)
    }
  },

  /**
   * Leave a stream
   */
  async leaveStream(workspaceId: string, streamId: string): Promise<void> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/leave`, {
      method: "POST",
      credentials: "include",
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.status}`)
    }
  },

  /**
   * Archive a stream
   */
  async archiveStream(workspaceId: string, streamId: string): Promise<Stream> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/archive`, {
      method: "POST",
      credentials: "include",
    })
    return handleResponse<Stream>(response)
  },

  /**
   * Mark stream as read up to an event
   */
  async markRead(workspaceId: string, streamId: string, eventId: string): Promise<void> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventId }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.status}`)
    }
  },

  /**
   * Update notification preferences for a stream
   */
  async updateNotifyLevel(
    workspaceId: string,
    streamId: string,
    level: "all" | "mentions" | "muted" | "default",
  ): Promise<void> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/streams/${streamId}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ level }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.status}`)
    }
  },

  /**
   * Get a single event by ID (with its parent stream)
   */
  async getEvent(workspaceId: string, eventId: string): Promise<{ event: StreamEvent; stream: Stream }> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/events/${eventId}`, {
      credentials: "include",
    })
    return handleResponse<{ event: StreamEvent; stream: Stream }>(response)
  },
}
