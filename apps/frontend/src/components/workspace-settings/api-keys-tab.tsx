import { useQuery } from "@tanstack/react-query"
import { ApiKeys, WorkOsWidgets } from "@workos-inc/widgets"
import "@radix-ui/themes/styles.css"
import "@workos-inc/widgets/styles.css"
import { workspacesApi } from "@/api/workspaces"
import { useResolvedTheme } from "@/contexts"
import { useCurrentWorkspaceUser } from "@/hooks/use-workspaces"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { UserApiKeysSection } from "./user-api-keys-section"

interface ApiKeysTabProps {
  workspaceId: string
}

export function ApiKeysTab({ workspaceId }: ApiKeysTabProps) {
  const currentUser = useCurrentWorkspaceUser(workspaceId)
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner"

  return (
    <div className="space-y-6 p-1">
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-medium">Personal keys</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            These keys act as you — same permissions, same stream access.
          </p>
        </div>
        <UserApiKeysSection workspaceId={workspaceId} />
      </section>

      {isAdmin && (
        <>
          <Separator />
          <section>
            <div className="mb-3">
              <h3 className="text-sm font-medium">Bot keys</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Workspace-wide keys for integrations. Messages sent with these appear as bots, not as a user.
              </p>
            </div>
            <WorkspaceApiKeysWidget workspaceId={workspaceId} />
          </section>
        </>
      )}
    </div>
  )
}

function WorkspaceApiKeysWidget({ workspaceId }: { workspaceId: string }) {
  const resolvedTheme = useResolvedTheme()

  const {
    data: token,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["widget-token", workspaceId],
    queryFn: () => workspacesApi.getWidgetToken(workspaceId),
    staleTime: 50 * 60 * 1000,
    refetchInterval: 50 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed py-6 text-center">
        <p className="text-sm text-muted-foreground">Failed to load shared key management</p>
      </div>
    )
  }

  return (
    <div className="api-keys-widget-container">
      <WorkOsWidgets
        theme={{
          appearance: resolvedTheme,
          accentColor: "amber",
          grayColor: "gray",
          radius: "medium",
        }}
      >
        <ApiKeys authToken={token!} />
      </WorkOsWidgets>
    </div>
  )
}
