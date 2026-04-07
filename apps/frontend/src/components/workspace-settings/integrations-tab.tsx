import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/auth/hooks"
import { integrationsApi } from "@/api/integrations"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspaceUsers } from "@/stores/workspace-store"

interface IntegrationsTabProps {
  workspaceId: string
}

export function IntegrationsTab({ workspaceId }: IntegrationsTabProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const workspaceUsers = useWorkspaceUsers(workspaceId)

  const currentWorkspaceUser = useMemo(
    () => workspaceUsers.find((workspaceUser) => workspaceUser.workosUserId === user?.id) ?? null,
    [user?.id, workspaceUsers]
  )
  const canManage = currentWorkspaceUser?.role === "admin" || currentWorkspaceUser?.role === "owner"

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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integrations</CardTitle>
            <CardDescription>Workspace admins manage shared third-party connections.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Only workspace admins and owners can manage integrations.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const configured = query.data?.configured ?? false
  const integration = query.data?.integration ?? null
  const repositories = integration?.repositories ?? []
  let statusVariant: "default" | "secondary" | "destructive" = "secondary"
  let statusLabel = "Not connected"

  if (!configured) {
    statusLabel = "Unavailable"
  } else if (integration?.status === "active") {
    statusVariant = "default"
    statusLabel = "Connected"
  } else if (integration?.status === "error") {
    statusVariant = "destructive"
    statusLabel = "Error"
  }

  return (
    <div className="space-y-4 p-1">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">GitHub</CardTitle>
            <CardDescription>
              Shared workspace installation for rich pull request, issue, commit, file, and comment previews.
            </CardDescription>
          </div>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <p className="text-sm text-muted-foreground">
              GitHub App credentials are not configured on this deployment yet.
            </p>
          )}

          {configured && integration?.status === "active" && (
            <>
              <div className="space-y-2">
                <div>
                  <h4 className="text-sm font-medium">Organization</h4>
                  <p className="text-sm text-muted-foreground">{integration.organizationName ?? "—"}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <h4 className="text-sm font-medium">Repository access</h4>
                    <p className="text-sm text-muted-foreground">
                      {integration.repositorySelection === "all" ? "All repositories" : "Selected repositories"}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium">Cached rate limit</h4>
                    <p className="text-sm text-muted-foreground">
                      {integration.rateLimit.remaining !== null
                        ? `${integration.rateLimit.remaining} requests remaining`
                        : "No rate limit data yet"}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium">Installed repositories</h4>
                {repositories.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {repositories.slice(0, 12).map((repository) => (
                      <Badge key={repository.fullName} variant="outline">
                        {repository.fullName}
                      </Badge>
                    ))}
                    {repositories.length > 12 && <Badge variant="outline">+{repositories.length - 12} more</Badge>}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No repositories cached yet.</p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium">Permissions</h4>
                {Object.keys(integration.permissions).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(integration.permissions).map(([permission, value]) => (
                      <Badge key={permission} variant="outline">
                        {permission}: {value}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No permission data cached yet.</p>
                )}
              </div>
            </>
          )}

          {configured && integration?.status !== "active" && (
            <p className="text-sm text-muted-foreground">
              Connect the Threa GitHub App to make GitHub links resolve as authenticated workspace previews.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {configured && (
              <Button asChild>
                <a href={`/api/workspaces/${workspaceId}/integrations/github/connect`}>
                  {integration?.status === "active" ? "Reconnect GitHub" : "Connect GitHub"}
                </a>
              </Button>
            )}

            {integration?.status === "active" && (
              <Button
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
              </Button>
            )}
          </div>

          {query.error && (
            <p className="text-sm text-destructive">
              {query.error instanceof Error ? query.error.message : "Failed to load integration status."}
            </p>
          )}

          {disconnectMutation.error && (
            <p className="text-sm text-destructive">
              {disconnectMutation.error instanceof Error
                ? disconnectMutation.error.message
                : "Failed to disconnect GitHub."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
