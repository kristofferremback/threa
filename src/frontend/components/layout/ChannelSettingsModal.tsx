import { useState, useEffect } from "react"
import { Hash, Lock, AlertTriangle } from "lucide-react"
import { Modal, ModalHeader, ModalFooter, Button, Input } from "../ui"
import type { Channel } from "../../types"

interface ChannelSettingsModalProps {
  open: boolean
  channel: Channel | null
  workspaceId: string
  onClose: () => void
  onUpdated: (channel: Channel) => void
  onArchived: (channelId: string) => void
}

export function ChannelSettingsModal({
  open,
  channel,
  workspaceId,
  onClose,
  onUpdated,
  onArchived,
}: ChannelSettingsModalProps) {
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [description, setDescription] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when channel changes
  useEffect(() => {
    if (channel) {
      setName(channel.name.replace("#", ""))
      setTopic(channel.topic || "")
      setDescription(channel.description || "")
      setError(null)
      setShowArchiveConfirm(false)
    }
  }, [channel])

  const handleSave = async () => {
    if (!channel || isSaving) return

    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          topic: topic.trim(),
          description: description.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to update channel")
      }

      const updated = await res.json()
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!channel || isArchiving) return

    setIsArchiving(true)
    setError(null)

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/channels/${channel.id}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to archive channel")
      }

      onArchived(channel.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setIsArchiving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !showArchiveConfirm) {
      e.preventDefault()
      handleSave()
    }
  }

  const handleClose = () => {
    setShowArchiveConfirm(false)
    setError(null)
    onClose()
  }

  if (!channel) return null

  const isPrivate = channel.visibility === "private"
  const Icon = isPrivate ? Lock : Hash
  const hasChanges =
    name.trim() !== channel.name.replace("#", "") ||
    topic.trim() !== (channel.topic || "") ||
    description.trim() !== (channel.description || "")

  return (
    <Modal open={open} onClose={handleClose}>
      <ModalHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" style={{ color: "var(--text-muted)" }} />
          <span>Channel settings</span>
        </div>
      </ModalHeader>

      {showArchiveConfirm ? (
        <div className="space-y-4">
          <div
            className="p-4 rounded-lg flex items-start gap-3"
            style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--danger)" }}
          >
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: "var(--danger)" }} />
            <div>
              <p className="font-medium" style={{ color: "var(--danger)" }}>
                Archive #{channel.name.replace("#", "")}?
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                This channel will be hidden from the sidebar. Messages will be preserved but the channel won't be
                accessible until unarchived.
              </p>
            </div>
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowArchiveConfirm(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="danger" onClick={handleArchive} loading={isArchiving} className="flex-1">
              Archive Channel
            </Button>
          </ModalFooter>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              Channel name
            </label>
            <div className="relative">
              <Icon
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: "var(--text-muted)" }}
              />
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="general"
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              Topic <span style={{ color: "var(--text-muted)" }}>(optional)</span>
            </label>
            <Input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's being discussed here?"
            />
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Displayed at the top of the channel
            </p>
          </div>

          <div>
            <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              Description <span style={{ color: "var(--text-muted)" }}>(optional)</span>
            </label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's this channel about?"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div
            className="pt-4 flex items-center justify-between"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => setShowArchiveConfirm(true)}
              className="text-sm hover:underline"
              style={{ color: "var(--danger)" }}
            >
              Archive channel
            </button>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!hasChanges || !name.trim()} loading={isSaving}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
