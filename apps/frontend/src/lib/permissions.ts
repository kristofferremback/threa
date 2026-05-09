import type { WorkspacePermissionSlug } from "@threa/types"

export function hasPermission(
  viewerPermissions: readonly WorkspacePermissionSlug[] | undefined,
  slug: WorkspacePermissionSlug
): boolean {
  return viewerPermissions?.includes(slug) ?? false
}
