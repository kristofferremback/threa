import { useState } from "react"
import { useParams } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/auth"
import { useWorkspaceBootstrap, useUpdateProfile } from "@/hooks"
import { AvatarSection } from "./avatar-section"
import { toast } from "sonner"
import type { WorkspaceMember } from "@threa/types"

function useCurrentMember(workspaceId: string): WorkspaceMember | null {
  const { user } = useAuth()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  if (!user || !bootstrap) return null
  return bootstrap.members.find((m) => m.userId === user.id) ?? null
}

export function ProfileSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const member = useCurrentMember(workspaceId!)
  const updateProfile = useUpdateProfile(workspaceId!)

  const [name, setName] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)

  if (!member) return null

  // Use local state if edited, otherwise show server value
  const currentName = name ?? member.name
  const currentDescription = description ?? member.description ?? ""

  const nameChanged = name !== null && name !== member.name
  const descriptionChanged = description !== null && (description || null) !== (member.description || null)
  const nameValid = currentName.trim().length > 0

  const handleSaveName = async () => {
    if (!nameChanged || !nameValid) return
    try {
      await updateProfile.mutateAsync({ name: currentName.trim() })
      setName(null)
      toast.success("Name updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update name")
    }
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSaveName()
    }
  }

  const handleSaveDescription = async () => {
    if (!descriptionChanged) return
    try {
      await updateProfile.mutateAsync({ description: currentDescription.trim() || null })
      setDescription(null)
      toast.success("Description updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update description")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Photo</h3>
        <AvatarSection workspaceId={workspaceId!} memberName={member.name} avatarUrl={member.avatarUrl} />
      </div>

      <div>
        <Label htmlFor="profile-name">Display name</Label>
        <div className="flex gap-2 mt-1.5">
          <Input
            id="profile-name"
            value={currentName}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            maxLength={100}
            className="flex-1"
          />
          {nameChanged && (
            <Button size="sm" onClick={handleSaveName} disabled={!nameValid || updateProfile.isPending}>
              Save
            </Button>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="profile-description">Description</Label>
          <span className="text-xs text-muted-foreground">{currentDescription.length}/500</span>
        </div>
        <div className="flex flex-col gap-2 mt-1.5">
          <Textarea
            id="profile-description"
            value={currentDescription}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="What do you do? A brief description."
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveDescription}
              disabled={!descriptionChanged || updateProfile.isPending}
              className={descriptionChanged ? "" : "invisible"}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
