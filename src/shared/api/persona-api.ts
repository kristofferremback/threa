/**
 * Persona API Client
 *
 * Platform-agnostic API client for agent persona operations.
 */

export type ToolName =
  | "search_memos"
  | "search_messages"
  | "get_stream_context"
  | "get_thread_history"
  | "web_search"
  | "fetch_url"

export const AVAILABLE_TOOLS: ToolName[] = [
  "search_memos",
  "search_messages",
  "get_stream_context",
  "get_thread_history",
  "web_search",
  "fetch_url",
]

export const TOOL_DESCRIPTIONS: Record<ToolName, { name: string; description: string }> = {
  search_memos: {
    name: "Search Memos",
    description: "Search through saved memos and knowledge",
  },
  search_messages: {
    name: "Search Messages",
    description: "Search through message history",
  },
  get_stream_context: {
    name: "Stream Context",
    description: "Get context about the current channel/thread",
  },
  get_thread_history: {
    name: "Thread History",
    description: "Retrieve full thread conversation history",
  },
  web_search: {
    name: "Web Search",
    description: "Search the web for information",
  },
  fetch_url: {
    name: "Fetch URL",
    description: "Fetch and read content from URLs",
  },
}

export interface PersonaMetadata {
  id: string
  name: string
  slug: string
  description: string
  avatarEmoji: string | null
  isDefault: boolean
  isActive: boolean
}

export interface Persona extends PersonaMetadata {
  workspaceId: string
  systemPrompt: string
  enabledTools: ToolName[] | null
  model: string
  temperature: number
  maxTokens: number
  allowedStreamIds: string[] | null
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CreatePersonaInput {
  name: string
  slug: string
  description: string
  avatarEmoji?: string
  systemPrompt: string
  enabledTools?: ToolName[]
  model?: string
  temperature?: number
  maxTokens?: number
  allowedStreamIds?: string[]
  isDefault?: boolean
}

export interface UpdatePersonaInput {
  name?: string
  slug?: string
  description?: string
  avatarEmoji?: string | null
  systemPrompt?: string
  enabledTools?: ToolName[] | null
  model?: string
  temperature?: number
  maxTokens?: number
  allowedStreamIds?: string[] | null
  isDefault?: boolean
  isActive?: boolean
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""
  return process.env.API_BASE_URL || ""
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.error || error.message || `API Error: ${response.status}`)
  }
  return response.json()
}

export const personaApi = {
  /**
   * List all personas in a workspace
   */
  async listPersonas(workspaceId: string): Promise<{ personas: PersonaMetadata[] }> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/personas`, {
      credentials: "include",
    })
    return handleResponse<{ personas: PersonaMetadata[] }>(response)
  },

  /**
   * Get a single persona by ID (full details)
   */
  async getPersona(workspaceId: string, personaId: string): Promise<{ persona: Persona }> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/personas/${personaId}`, {
      credentials: "include",
    })
    return handleResponse<{ persona: Persona }>(response)
  },

  /**
   * Create a new persona
   */
  async createPersona(workspaceId: string, input: CreatePersonaInput): Promise<{ persona: Persona }> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/personas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    })
    return handleResponse<{ persona: Persona }>(response)
  },

  /**
   * Update an existing persona
   */
  async updatePersona(
    workspaceId: string,
    personaId: string,
    input: UpdatePersonaInput,
  ): Promise<{ persona: Persona }> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/personas/${personaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    })
    return handleResponse<{ persona: Persona }>(response)
  },

  /**
   * Delete a persona (soft delete)
   */
  async deletePersona(workspaceId: string, personaId: string): Promise<void> {
    const response = await fetch(`${getBaseUrl()}/api/workspace/${workspaceId}/personas/${personaId}`, {
      method: "DELETE",
      credentials: "include",
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.error || error.message || `API Error: ${response.status}`)
    }
  },
}
