import { useQuery, useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { useFormattedDate } from "@/hooks"
import { formatRegion } from "@/lib/regions"
import type { WorkspaceBootstrap } from "@threa/types"

interface GeneralTabProps {
  workspaceId: string
}

export function GeneralTab({ workspaceId }: GeneralTabProps) {
  const queryClient = useQueryClient()
  const { formatDate } = useFormattedDate()

  const { data: bootstrapData } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  const workspace = bootstrapData?.workspace

  return (
    <div className="space-y-4 p-1">
      <div>
        <h3 className="text-sm font-medium">Name</h3>
        <p className="text-sm text-muted-foreground">{workspace?.name ?? "—"}</p>
      </div>

      {workspace?.region && (
        <div>
          <h3 className="text-sm font-medium">Data region</h3>
          <p className="text-sm text-muted-foreground">{formatRegion(workspace.region)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Where your workspace data is stored</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium">Created</h3>
        <p className="text-sm text-muted-foreground">
          {workspace?.createdAt ? formatDate(new Date(workspace.createdAt)) : "—"}
        </p>
      </div>
    </div>
  )
}
