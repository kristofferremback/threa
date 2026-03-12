import { useParams, useNavigate } from "react-router-dom"
import { MessageCircle, Phone, Github, Globe } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog"
import { useWorkspaceBootstrap } from "@/hooks"
import { useAuth } from "@/auth"
import { createDmDraftId } from "@/hooks"
import { getAvatarUrl, type User } from "@threa/types"

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

function getRoleBadge(role: User["role"]) {
  switch (role) {
    case "owner":
      return <Badge variant="secondary">Owner</Badge>
    case "admin":
      return <Badge variant="secondary">Admin</Badge>
    default:
      return null
  }
}

interface UserProfileModalProps {
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserProfileModal({ userId, open, onOpenChange }: UserProfileModalProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")

  const user = bootstrap?.users.find((u) => u.id === userId)
  const isOwnProfile = authUser && user?.workosUserId === authUser.id
  const avatarUrl = user ? getAvatarUrl(workspaceId!, user.avatarUrl, 256) : undefined

  const handleMessage = () => {
    if (!workspaceId || !userId) return
    const dmDraftId = createDmDraftId(userId)

    // Check if a DM stream already exists for this peer
    const existingDmStreamId = bootstrap?.dmPeers.find((p) => p.userId === userId)?.streamId
    const streamId = existingDmStreamId ?? dmDraftId

    onOpenChange(false)
    navigate(`/w/${workspaceId}/s/${streamId}`)
  }

  if (!user) return null

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="sr-only">Profile</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">Profile for {user.name}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4 pb-6">
          <div className="flex flex-col items-center gap-3 pt-2">
            <Avatar className="h-24 w-24 rounded-2xl">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={user.name} />}
              <AvatarFallback className="text-2xl bg-muted text-foreground rounded-2xl">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="text-center">
              <h2 className="text-xl font-semibold">{user.name}</h2>
              {user.pronouns && <p className="text-sm text-muted-foreground">{user.pronouns}</p>}
              <div className="mt-1">{getRoleBadge(user.role)}</div>
            </div>
          </div>

          {user.description && <p className="text-sm text-center text-muted-foreground">{user.description}</p>}

          {(user.phone || user.githubUsername || user.timezone) && (
            <>
              <Separator />
              <div className="space-y-2.5">
                {user.phone && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{user.phone}</span>
                  </div>
                )}
                {user.githubUsername && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Github className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a
                      href={`https://github.com/${user.githubUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {user.githubUsername}
                    </a>
                  </div>
                )}
                {user.timezone && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{user.timezone}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {!isOwnProfile && (
            <>
              <Separator />
              <Button className="w-full" onClick={handleMessage}>
                <MessageCircle className="h-4 w-4 mr-2" />
                Message
              </Button>
            </>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
