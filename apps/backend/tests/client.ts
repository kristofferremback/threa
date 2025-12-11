/**
 * HTTP client for E2E tests with cookie jar support.
 * Black box testing - treats the API as an external service.
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001"

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

    const response = await fetch(`${BASE_URL}${path}`, {
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
}

export interface Message {
  id: string
  content: string
  sequence: string
  authorId: string
  reactions: Record<string, string[]>
}

export async function loginAs(
  client: TestClient,
  email: string,
  name: string
): Promise<User> {
  const { status, data } = await client.post<{ user: User }>("/api/dev/login", {
    email,
    name,
  })
  if (status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(data)}`)
  }
  return data.user
}

export async function createWorkspace(
  client: TestClient,
  name: string
): Promise<Workspace> {
  const { status, data } = await client.post<{ workspace: Workspace }>(
    "/api/workspaces",
    { name }
  )
  if (status !== 201) {
    throw new Error(`Create workspace failed: ${JSON.stringify(data)}`)
  }
  return data.workspace
}

export async function createScratchpad(
  client: TestClient,
  workspaceId: string,
  companionMode: "off" | "on" | "next_message_only" = "on"
): Promise<Stream> {
  const { status, data } = await client.post<{ stream: Stream }>(
    `/api/workspaces/${workspaceId}/scratchpads`,
    { companionMode }
  )
  if (status !== 201) {
    throw new Error(`Create scratchpad failed: ${JSON.stringify(data)}`)
  }
  return data.stream
}

export async function sendMessage(
  client: TestClient,
  streamId: string,
  content: string
): Promise<Message> {
  const { status, data } = await client.post<{ message: Message }>(
    `/api/streams/${streamId}/messages`,
    { content }
  )
  if (status !== 201) {
    throw new Error(`Send message failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export async function listMessages(
  client: TestClient,
  streamId: string
): Promise<Message[]> {
  const { status, data } = await client.get<{ messages: Message[] }>(
    `/api/streams/${streamId}/messages`
  )
  if (status !== 200) {
    throw new Error(`List messages failed: ${JSON.stringify(data)}`)
  }
  return data.messages
}

export async function createChannel(
  client: TestClient,
  workspaceId: string,
  slug: string,
  visibility: "public" | "private" = "private"
): Promise<Stream> {
  const { status, data } = await client.post<{ stream: Stream }>(
    `/api/workspaces/${workspaceId}/channels`,
    { slug, visibility }
  )
  if (status !== 201) {
    throw new Error(`Create channel failed: ${JSON.stringify(data)}`)
  }
  return data.stream
}

export async function addReaction(
  client: TestClient,
  messageId: string,
  emoji: string
): Promise<Message> {
  const { status, data } = await client.post<{ message: Message }>(
    `/api/messages/${messageId}/reactions`,
    { emoji }
  )
  if (status !== 200) {
    throw new Error(`Add reaction failed: ${JSON.stringify(data)}`)
  }
  return data.message
}

export async function removeReaction(
  client: TestClient,
  messageId: string,
  emoji: string
): Promise<Message> {
  const { status, data } = await client.delete<{ message: Message }>(
    `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
  )
  if (status !== 200) {
    throw new Error(`Remove reaction failed: ${JSON.stringify(data)}`)
  }
  return data.message
}
