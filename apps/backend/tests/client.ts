/**
 * HTTP client for E2E tests with cookie jar support.
 * Black box testing - treats the API as an external service.
 */

function getBaseUrl(): string {
  // Read at call time, not import time, so setup.ts can set it
  return process.env.TEST_BASE_URL || "http://localhost:3001"
}

export class TestClient {
  private cookies: Map<string, string> = new Map()

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const headers: Record<string, string> = {}

    if (body) {
      headers["Content-Type"] = "application/json"
    }

    if (this.cookies.size > 0) {
      headers["Cookie"] = Array.from(this.cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
    }

    const response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    // Parse Set-Cookie headers
    const setCookies = response.headers.getSetCookie?.() || []
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";")
      const [name, value] = pair.split("=")
      if (name && value) {
        this.cookies.set(name.trim(), value.trim())
      }
    }

    const data = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text()

    return { status: response.status, data: data as T, headers: response.headers }
  }

  get<T = unknown>(path: string) {
    return this.request<T>("GET", path)
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body)
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, body)
  }

  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path)
  }

  /**
   * Upload a file using multipart/form-data.
   */
  async uploadFile<T = unknown>(
    path: string,
    file: { content: string | Buffer; filename: string; mimeType: string }
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const formData = new FormData()
    const blob = new Blob([file.content], { type: file.mimeType })
    formData.append("file", blob, file.filename)

    const headers: Record<string, string> = {}
    if (this.cookies.size > 0) {
      headers["Cookie"] = Array.from(this.cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
    }

    const response = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      headers,
      body: formData,
    })

    // Parse Set-Cookie headers
    const setCookies = response.headers.getSetCookie?.() || []
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";")
      const [name, value] = pair.split("=")
      if (name && value) {
        this.cookies.set(name.trim(), value.trim())
      }
    }

    const data = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text()

    return { status: response.status, data: data as T, headers: response.headers }
  }

  clearCookies() {
    this.cookies.clear()
  }
}

// Helpers for common operations
export interface User {
  id: string
  email: string
  name: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
}

export interface Stream {
  id: string
  type: string
  displayName: string | null
  slug: string | null
  companionMode: string
  workspaceId: string
}

export interface Message {
  id: string
  content: string
  sequence: string
  authorId: string
  reactions: Record<string, string[]>
  streamId: string
}

export interface StreamEvent {
  id: string
  streamId: string
  sequence: string
  eventType: string
  payload: unknown
  actorId: string | null
  actorType: string | null
  createdAt: string
}

export interface Attachment {
  id: string
  workspaceId: string
  streamId: string
  messageId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  storageProvider: string
  processingStatus: string
  createdAt: string
}

export async function loginAs(client: TestClient, email: string, name: string): Promise<User> {
  const { status, data } = await client.post<{ user: User }>("/api/dev/login", {
    email,
    name,
  })
  if (status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`)
  }
  return data.user
}

export async function createWorkspace(client: TestClient, name: string): Promise<Workspace> {
  const { status, data } = await client.post<{ workspace: Workspace }>("/api/workspaces", { name })
  if (status !== 201) {
    throw new Error(`Create workspace failed: ${JSON.stringify(data)}`)
  }
  return data.workspace
}

export async function createStream(
  client: TestClient,
  workspaceId: string,
  type: "scratchpad" | "channel",
  options?: {
    slug?: string
    companionMode?: "off" | "on"
    visibility?: "public" | "private"
  }
): Promise<Stream> {
  const { status, data } = await client.post<{ stream: Stream }>(`/api/workspaces/${workspaceId}/streams`, {
    type,
    ...options,
  })
  if (status !== 201) {
    throw new Error(`Create stream failed: ${JSON.stringify(data)}`)
  }
  return data.stream
}

export async function createScratchpad(
  client: TestClient,
  workspaceId: string,
  companionMode: "off" | "on" = "on"
): Promise<Stream> {
  return createStream(client, workspaceId, "scratchpad", { companionMode })
}

export async function createChannel(
  client: TestClient,
  workspaceId: string,
  slug: string,
  visibility: "public" | "private" = "private"
): Promise<Stream> {
  return createStream(client, workspaceId, "channel", { slug, visibility })
}

export async function listStreams(client: TestClient, workspaceId: string, types?: string[]): Promise<Stream[]> {
  const params = new URLSearchParams()
  if (types) {
    types.forEach((t) => params.append("stream_type", t))
  }
  const query = params.toString() ? `?${params.toString()}` : ""

  const { status, data } = await client.get<{ streams: Stream[] }>(`/api/workspaces/${workspaceId}/streams${query}`)
  if (status !== 200) {
    throw new Error(`List streams failed: ${JSON.stringify(data)}`)
  }
  return data.streams
}

export async function sendMessage(
  client: TestClient,
  workspaceId: string,
  streamId: string,
  content: string
): Promise<Message> {
  const { status, data } = await client.post<{ message: Message }>(`/api/workspaces/${workspaceId}/messages`, {
    streamId,
    content,
  })
  if (status !== 201) {
    throw new Error(`Send message failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export async function listEvents(
  client: TestClient,
  workspaceId: string,
  streamId: string,
  types?: string[]
): Promise<StreamEvent[]> {
  const params = new URLSearchParams()
  if (types) {
    types.forEach((t) => params.append("type", t))
  }
  const query = params.toString() ? `?${params.toString()}` : ""

  const { status, data } = await client.get<{ events: StreamEvent[] }>(
    `/api/workspaces/${workspaceId}/streams/${streamId}/events${query}`
  )
  if (status !== 200) {
    throw new Error(`List events failed: ${JSON.stringify(data)}`)
  }
  return data.events
}

export async function addReaction(
  client: TestClient,
  workspaceId: string,
  messageId: string,
  emoji: string
): Promise<Message> {
  const { status, data } = await client.post<{ message: Message }>(
    `/api/workspaces/${workspaceId}/messages/${messageId}/reactions`,
    { emoji }
  )
  if (status !== 200) {
    throw new Error(`Add reaction failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export async function removeReaction(
  client: TestClient,
  workspaceId: string,
  messageId: string,
  emoji: string
): Promise<Message> {
  const { status, data } = await client.delete<{ message: Message }>(
    `/api/workspaces/${workspaceId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
  )
  if (status !== 200) {
    throw new Error(`Remove reaction failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export async function getStream(client: TestClient, workspaceId: string, streamId: string): Promise<Stream> {
  const { status, data } = await client.get<{ stream: Stream }>(`/api/workspaces/${workspaceId}/streams/${streamId}`)
  if (status !== 200) {
    throw new Error(`Get stream failed: ${JSON.stringify(data)}`)
  }
  return data.stream
}

export async function updateCompanionMode(
  client: TestClient,
  workspaceId: string,
  streamId: string,
  companionMode: "off" | "on"
): Promise<Stream> {
  const { status, data } = await client.patch<{ stream: Stream }>(
    `/api/workspaces/${workspaceId}/streams/${streamId}/companion`,
    { companionMode }
  )
  if (status !== 200) {
    throw new Error(`Update companion mode failed: ${JSON.stringify(data)}`)
  }
  return data.stream
}

export async function updateMessage(
  client: TestClient,
  workspaceId: string,
  messageId: string,
  content: string
): Promise<Message> {
  const { status, data } = await client.patch<{ message: Message }>(
    `/api/workspaces/${workspaceId}/messages/${messageId}`,
    { content }
  )
  if (status !== 200) {
    throw new Error(`Update message failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export async function deleteMessage(client: TestClient, workspaceId: string, messageId: string): Promise<void> {
  const { status } = await client.delete(`/api/workspaces/${workspaceId}/messages/${messageId}`)
  if (status !== 204) {
    throw new Error(`Delete message failed with status ${status}`)
  }
}

export async function uploadAttachment(
  client: TestClient,
  workspaceId: string,
  streamId: string,
  file: { content: string | Buffer; filename: string; mimeType: string }
): Promise<Attachment> {
  const { status, data } = await client.uploadFile<{ attachment: Attachment }>(
    `/api/workspaces/${workspaceId}/streams/${streamId}/attachments`,
    file
  )
  if (status !== 201) {
    throw new Error(`Upload attachment failed: ${JSON.stringify(data)}`)
  }
  return data.attachment
}

export async function getAttachmentDownloadUrl(
  client: TestClient,
  workspaceId: string,
  attachmentId: string
): Promise<string> {
  const { status, data } = await client.get<{ url: string; expiresIn: number }>(
    `/api/workspaces/${workspaceId}/attachments/${attachmentId}/url`
  )
  if (status !== 200) {
    throw new Error(`Get attachment URL failed: ${JSON.stringify(data)}`)
  }
  return data.url
}

export async function deleteAttachment(client: TestClient, workspaceId: string, attachmentId: string): Promise<void> {
  const { status } = await client.delete(`/api/workspaces/${workspaceId}/attachments/${attachmentId}`)
  if (status !== 204) {
    throw new Error(`Delete attachment failed with status ${status}`)
  }
}

export async function sendMessageWithAttachments(
  client: TestClient,
  workspaceId: string,
  streamId: string,
  content: string,
  attachmentIds: string[]
): Promise<Message> {
  const { status, data } = await client.post<{ message: Message }>(`/api/workspaces/${workspaceId}/messages`, {
    streamId,
    content,
    attachmentIds,
  })
  if (status !== 201) {
    throw new Error(`Send message failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export interface WorkspaceMember {
  workspaceId: string
  userId: string
  role: string
}

export interface StreamMember {
  streamId: string
  userId: string
}

export async function joinWorkspace(
  client: TestClient,
  workspaceId: string,
  role: "member" | "admin" = "member"
): Promise<WorkspaceMember> {
  const { status, data } = await client.post<{ member: WorkspaceMember }>(`/api/dev/workspaces/${workspaceId}/join`, {
    role,
  })
  if (status !== 200) {
    throw new Error(`Join workspace failed: ${JSON.stringify(data)}`)
  }
  return data.member
}

export async function joinStream(client: TestClient, workspaceId: string, streamId: string): Promise<StreamMember> {
  const { status, data } = await client.post<{ member: StreamMember }>(
    `/api/dev/workspaces/${workspaceId}/streams/${streamId}/join`
  )
  if (status !== 200) {
    throw new Error(`Join stream failed: ${JSON.stringify(data)}`)
  }
  return data.member
}
