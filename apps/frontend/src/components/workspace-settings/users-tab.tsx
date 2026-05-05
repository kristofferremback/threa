import { useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Copy, Link as LinkIcon, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { invitationsApi } from "@/api/invitations"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { useFormattedDate } from "@/hooks"
import { InviteDialog } from "./invite-dialog"
import { CreateInviteLinkDialog } from "./create-invite-link-dialog"
import type { User, WorkspaceInvitation } from "@threa/types"

interface UsersTabProps {
  workspaceId: string
}

function buildJoinUrl(token: string): string {
  if (typeof window === "undefined") return `/join/${token}`
  return `${window.location.origin}/join/${token}`
}

export function UsersTab({ workspaceId }: UsersTabProps) {
  const [emailInviteOpen, setEmailInviteOpen] = useState(false)
  const [linkInviteOpen, setLinkInviteOpen] = useState(false)
  const [copiedInvitationId, setCopiedInvitationId] = useState<string | null>(null)

  // Tokens are returned exactly once at create time; we keep them in-memory so
  // the admin can copy the link from the pending list. Refreshing the page
  // discards the map — there's no API to retrieve a token after creation.
  const tokensRef = useRef<Map<string, string>>(new Map())

  const queryClient = useQueryClient()
  const { formatDate } = useFormattedDate()

  const { data: bootstrapData } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () =>
      queryClient.getQueryData<{
        users: User[]
        invitations?: WorkspaceInvitation[]
      }>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  const users = bootstrapData?.users ?? []

  const invitationsQuery = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: () => invitationsApi.list(workspaceId),
  })

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(workspaceId, invitationId),
    onSuccess: (_, invitationId) => {
      tokensRef.current.delete(invitationId)
      invitationsQuery.refetch()
    },
  })

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.resend(workspaceId, invitationId),
    onSuccess: () => invitationsQuery.refetch(),
  })

  const pendingInvitations = (invitationsQuery.data ?? []).filter((i) => i.status === "pending")

  const handleCopy = async (invitationId: string) => {
    const token = tokensRef.current.get(invitationId)
    if (!token) return
    try {
      await navigator.clipboard.writeText(buildJoinUrl(token))
      setCopiedInvitationId(invitationId)
      setTimeout(() => setCopiedInvitationId(null), 2000)
    } catch {
      // Clipboard API can fail in insecure contexts — ignore silently.
    }
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Members ({users.length})</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              Invite
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEmailInviteOpen(true)}>
              <Mail className="mr-2 h-4 w-4" />
              <span>Invite by email</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLinkInviteOpen(true)}>
              <LinkIcon className="mr-2 h-4 w-4" />
              <span>Create invite link</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-2">
        {users.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 min-w-0">
              <span className="text-sm font-medium truncate">{user.name || user.slug}</span>
              <span className="text-xs text-muted-foreground truncate">@{user.slug}</span>
            </div>
            <Badge variant={user.role === "owner" ? "default" : "secondary"} className="shrink-0">
              {user.role}
            </Badge>
          </div>
        ))}
      </div>

      {pendingInvitations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Pending invitations ({pendingInvitations.length})</h3>
          <div className="space-y-2">
            {pendingInvitations.map((invitation) => {
              const isLink = invitation.kind === "link"
              const tokenInMemory = tokensRef.current.has(invitation.id)
              const isCopied = copiedInvitationId === invitation.id

              return (
                <div
                  key={invitation.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 min-w-0">
                      {isLink && !invitation.email ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium truncate">
                          <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          Invite link
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm truncate">
                          {isLink ? (
                            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="truncate">{invitation.email}</span>
                        </span>
                      )}
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="capitalize">
                          {invitation.role}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Expires {formatDate(new Date(invitation.expiresAt))}
                        </span>
                      </div>
                    </div>
                    {invitation.note && (
                      <p className="text-xs text-muted-foreground truncate" title={invitation.note}>
                        {invitation.note}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isLink && !invitation.email ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(invitation.id)}
                        disabled={!tokenInMemory}
                        title={tokenInMemory ? "Copy link to clipboard" : "Link only available right after creation"}
                      >
                        {isCopied ? (
                          <>
                            <Check className="mr-1 h-3.5 w-3.5 text-green-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="mr-1 h-3.5 w-3.5" />
                            {tokenInMemory ? "Copy link" : "Link sent"}
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resendMutation.mutate(invitation.id)}
                        disabled={resendMutation.isPending}
                      >
                        Resend
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revokeMutation.mutate(invitation.id)}
                      disabled={revokeMutation.isPending}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <InviteDialog
        workspaceId={workspaceId}
        open={emailInviteOpen}
        onOpenChange={setEmailInviteOpen}
        onSuccess={() => invitationsQuery.refetch()}
      />
      <CreateInviteLinkDialog
        workspaceId={workspaceId}
        open={linkInviteOpen}
        onOpenChange={setLinkInviteOpen}
        onSuccess={() => {
          invitationsQuery.refetch()
        }}
        onTokenCreated={(invitationId, token) => {
          tokensRef.current.set(invitationId, token)
        }}
      />
    </div>
  )
}
