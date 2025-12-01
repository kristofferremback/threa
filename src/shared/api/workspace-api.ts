/**
 * Workspace API Client
 *
 * Platform-agnostic API client for workspace operations.
 * Handles bootstrap, users, and workspace-level settings.
 */

import type { BootstrapData, NotificationsResponse } from "./types"

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

export const workspaceApi = {
  /**
   * Get bootstrap data for a workspace (streams, users, workspace info)
   */
  async getBootstrap(workspaceId: string): Promise<BootstrapData> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/${workspaceId}/bootstrap`,
      { credentials: "include" }
    )
    return handleResponse<BootstrapData>(response)
  },

  /**
   * Get current user's notifications
   */
  async getNotifications(workspaceId: string): Promise<NotificationsResponse> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/${workspaceId}/notifications`,
      { credentials: "include" }
    )
    return handleResponse<NotificationsResponse>(response)
  },

  /**
   * Mark notifications as read
   */
  async markNotificationsRead(
    workspaceId: string,
    notificationIds: string[]
  ): Promise<void> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/${workspaceId}/notifications/read`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: notificationIds }),
      }
    )
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.status}`)
    }
  },

  /**
   * Update workspace user profile
   */
  async updateProfile(
    workspaceId: string,
    data: { displayName?: string; title?: string }
  ): Promise<void> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/${workspaceId}/profile`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      }
    )
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.status}`)
    }
  },

  /**
   * Get workspace by slug (for URL routing)
   */
  async getWorkspaceBySlug(slug: string): Promise<{ id: string; name: string; slug: string }> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/by-slug/${slug}`,
      { credentials: "include" }
    )
    return handleResponse<{ id: string; name: string; slug: string }>(response)
  },

  /**
   * Search users in workspace
   */
  async searchUsers(
    workspaceId: string,
    query: string
  ): Promise<Array<{ id: string; name: string; email: string }>> {
    const response = await fetch(
      `${getBaseUrl()}/api/workspace/${workspaceId}/users/search?q=${encodeURIComponent(query)}`,
      { credentials: "include" }
    )
    return handleResponse<Array<{ id: string; name: string; email: string }>>(response)
  },
}
