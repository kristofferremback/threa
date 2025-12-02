/**
 * Settings API Client
 *
 * Platform-agnostic API client for user settings operations.
 */

export type CollapseState = "open" | "soft" | "hard"

export interface SidebarCollapseSettings {
  pinned: CollapseState
  channels: CollapseState
  thinkingSpaces: CollapseState
  directMessages: CollapseState
}

export interface UserSettings {
  theme?: "light" | "dark" | "system"
  sidebarCollapse?: SidebarCollapseSettings
  notifications?: {
    desktop?: boolean
    sound?: boolean
    mentions?: boolean
  }
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""
  return process.env.API_BASE_URL || ""
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message || `API Error: ${response.status}`)
  }
  return response.json()
}

export const settingsApi = {
  /**
   * Get all user settings for a workspace
   */
  async getSettings(workspaceId: string): Promise<{ settings: UserSettings }> {
    const response = await fetch(`${getBaseUrl()}/api/workspaces/${workspaceId}/settings`, {
      credentials: "include",
    })
    return handleResponse<{ settings: UserSettings }>(response)
  },

  /**
   * Update user settings (partial update)
   */
  async updateSettings(workspaceId: string, updates: Partial<UserSettings>): Promise<{ settings: UserSettings }> {
    const response = await fetch(`${getBaseUrl()}/api/workspaces/${workspaceId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(updates),
    })
    return handleResponse<{ settings: UserSettings }>(response)
  },

  /**
   * Update a specific setting by path
   */
  async updateSetting(
    workspaceId: string,
    path: string,
    value: unknown,
  ): Promise<{ settings: UserSettings }> {
    const response = await fetch(`${getBaseUrl()}/api/workspaces/${workspaceId}/settings/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ value }),
    })
    return handleResponse<{ settings: UserSettings }>(response)
  },
}
