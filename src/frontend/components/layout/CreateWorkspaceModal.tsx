import { useState } from "react"
import { Modal, ModalHeader, ModalFooter, Button, Input } from "../ui"

interface CreateWorkspaceModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export function CreateWorkspaceModal({ open, onClose, onCreated }: CreateWorkspaceModalProps) {
  const [name, setName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim() || isCreating) return

    setIsCreating(true)
    setError(null)

    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim() }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create workspace")
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader>Create a workspace</ModalHeader>

      <div className="space-y-4">
        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
            Workspace name
          </label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Acme Inc."
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()} loading={isCreating} className="flex-1">
            Create
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
