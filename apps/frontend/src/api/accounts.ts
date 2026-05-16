import { api } from "./client"

export const accountsApi = {
  // Bare-workspace form only: "which signed-in account owns this workspace?"
  // (used by the cross-account deep-link guard). The identity (`userId`) form
  // is backend-only until its notification-click caller lands.
  resolve(workspaceId: string): Promise<{ ownerUserId: string }> {
    return api.get<{ ownerUserId: string }>(`/api/accounts/resolve?workspaceId=${encodeURIComponent(workspaceId)}`)
  },
}
