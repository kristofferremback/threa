import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Github, ExternalLink } from "lucide-react"
import { integrationsApi } from "@/api/integrations"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspaceMetadata } from "@/stores/workspace-store"

interface IntegrationsTabProps {
  workspaceId: string
}

export function IntegrationsTab({ workspaceId }: IntegrationsTabProps) {
  const queryClient = useQueryClient()
  const metadata = useWorkspaceMetadata(workspaceId)
  const canManage = metadata?.viewerPermissions?.includes("workspace:admin") ?? false

  const query = useQuery({
    queryKey: ["workspace-integrations", workspaceId, "github"],
    queryFn: () => integrationsApi.getGithub(workspaceId),
    enabled: canManage,
  })

  const disconnectMutation = useMutation({
    mutationFn: () => integrationsApi.disconnectGithub(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-integrations", workspaceId, "github"] })
    },
  })

  if (!canManage) {
    return (
      <div className="space-y-4 p-1">
        <p className="text-sm text-muted-foreground">Only workspace admins and owners can manage integrations.</p>
      </div>
    )
  }

  if (query.isLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-32" />
      </div>
    )
  }

  const configured = query.data?.configured ?? false
  const integration = query.data?.integration ?? null
  const repositories = integration?.repositories ?? []
  const isActive = integration?.status === "active"

  return (
    <div className="space-y-6 p-1">
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Github className="h-4 w-4 text-foreground" />
          <h3 className="text-sm font-medium">GitHub</h3>
          {isActive && (
            <Badge variant="default" className="hover:bg-primary">
              Connected
            </Badge>
          )}
          {configured && !isActive && integration?.status === "error" && (
            <Badge variant="destructive" className="hover:bg-destructive">
              Error
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Rich previews for pull requests, issues, commits, files, and comments.
        </p>

        {!configured && (
          <p className="mt-3 text-sm text-muted-foreground">
            GitHub App credentials are not configured on this deployment yet.
          </p>
        )}

        {configured && isActive && (
          <div className="mt-3 space-y-3">
            {integration.organizationName && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">Organization</h4>
                <p className="text-sm">{integration.organizationName}</p>
              </div>
            )}

            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Repository access</h4>
              <p className="text-sm">
                {integration.repositorySelection === "all" ? "All repositories" : "Selected repositories"}
              </p>
            </div>

            {repositories.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">Repositories</h4>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {repositories.slice(0, 12).map((repository) => (
                    <Badge key={repository.fullName} variant="outline" className="text-xs font-normal">
                      {repository.fullName}
                    </Badge>
                  ))}
                  {repositories.length > 12 && (
                    <span className="text-xs text-muted-foreground self-center">+{repositories.length - 12} more</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {configured && !isActive && (
          <p className="mt-3 text-sm text-muted-foreground">
            Connect the Threa GitHub App to enable authenticated workspace previews.
          </p>
        )}

        {configured && (
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" asChild>
              <a href={`/api/workspaces/${workspaceId}/integrations/github/connect`}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                {isActive ? "Reconnect" : "Connect GitHub"}
              </a>
            </Button>
            {isActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? "Disconnecting\u2026" : "Disconnect"}
              </Button>
            )}
          </div>
        )}

        {query.error && (
          <p className="mt-2 text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Failed to load integration status."}
          </p>
        )}

        {disconnectMutation.error && (
          <p className="mt-2 text-sm text-destructive">
            {disconnectMutation.error instanceof Error
              ? disconnectMutation.error.message
              : "Failed to disconnect GitHub."}
          </p>
        )}
      </section>
    </div>
  )
}
