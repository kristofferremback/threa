import { useQuery } from "@tanstack/react-query"
import { ApiKeys, WorkOsWidgets } from "@workos-inc/widgets"
import "@radix-ui/themes/styles.css"
import "@workos-inc/widgets/styles.css"
import { workspacesApi } from "@/api/workspaces"
import { useResolvedTheme } from "@/contexts"

interface ApiKeysTabProps {
  workspaceId: string
}

export function ApiKeysTab({ workspaceId }: ApiKeysTabProps) {
  const resolvedTheme = useResolvedTheme()

  const {
    data: token,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["widget-token", workspaceId],
    queryFn: () => workspacesApi.getWidgetToken(workspaceId),
    staleTime: 50 * 60 * 1000, // Token valid for 1 hour, refresh at 50 min
    refetchInterval: 50 * 60 * 1000, // Proactively renew while tab is open
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>
  if (error) return <div className="text-sm text-destructive">Failed to load API key management</div>

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
