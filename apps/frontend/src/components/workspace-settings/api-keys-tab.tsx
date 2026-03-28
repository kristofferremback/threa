import { useQuery } from "@tanstack/react-query"
import { ApiKeys, WorkOsWidgets } from "@workos-inc/widgets"
import "@radix-ui/themes/styles.css"
import "@workos-inc/widgets/styles.css"
import { workspacesApi } from "@/api/workspaces"
import { useResolvedTheme } from "@/contexts"
import { useCurrentWorkspaceUser } from "@/hooks/use-workspaces"
import { UserApiKeysSection } from "./user-api-keys-section"

interface ApiKeysTabProps {
  workspaceId: string
}

export function ApiKeysTab({ workspaceId }: ApiKeysTabProps) {
  const currentUser = useCurrentWorkspaceUser(workspaceId)
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner"

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold mb-3">My API Keys</h3>
        <UserApiKeysSection workspaceId={workspaceId} />
      </section>

      {isAdmin && (
        <section>
          <h3 className="text-sm font-semibold mb-3">Workspace API Keys</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Workspace-scoped keys are shared across the organization. Messages sent via these keys appear as bots.
          </p>
          <WorkspaceApiKeysWidget workspaceId={workspaceId} />
        </section>
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

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (error) return <div className="text-sm text-destructive">Failed to load workspace API key management</div>

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
