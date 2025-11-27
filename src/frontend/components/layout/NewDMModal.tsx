import { useState, useCallback, useMemo } from "react"
import { X, Search, Check, MessageCircle } from "lucide-react"
import { Avatar, Button, Spinner } from "../ui"

interface User {
  id: string
  name: string | null
  email: string
}

interface NewDMModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateDM: (participantIds: string[]) => Promise<void>
  users: User[]
  currentUserId: string
}

export function NewDMModal({ isOpen, onClose, onCreateDM, users, currentUserId }: NewDMModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  // Filter out current user and search
  const availableUsers = useMemo(() => {
    return users
      .filter((u) => u.id !== currentUserId)
      .filter((u) => {
        if (!searchQuery) return true
        const query = searchQuery.toLowerCase()
        return (
          (u.name?.toLowerCase() || "").includes(query) ||
          u.email.toLowerCase().includes(query)
        )
      })
  }, [users, currentUserId, searchQuery])

  const toggleUser = useCallback((userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }, [])

  const handleCreate = async () => {
    if (selectedUsers.length === 0) return

    setIsCreating(true)
    try {
      await onCreateDM(selectedUsers)
      setSelectedUsers([])
      setSearchQuery("")
      onClose()
    } catch (error) {
      console.error("Failed to create DM:", error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    setSelectedUsers([])
    setSearchQuery("")
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-md mx-4 rounded-xl shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-primary)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            New message
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-[var(--hover-overlay)] transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
          >
            <Search className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
              autoFocus
            />
          </div>

          {/* Selected users */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {selectedUsers.map((userId) => {
                const user = users.find((u) => u.id === userId)
                if (!user) return null
                return (
                  <span
                    key={userId}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                    style={{ background: "var(--accent-glow)", color: "var(--accent-primary)" }}
                  >
                    {user.name || user.email.split("@")[0]}
                    <button
                      onClick={() => toggleUser(userId)}
                      className="hover:opacity-70 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* User list */}
        <div className="max-h-64 overflow-y-auto">
          {availableUsers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {searchQuery ? "No users found" : "No other users in workspace"}
              </p>
            </div>
          ) : (
            <div className="p-2">
              {availableUsers.map((user) => {
                const isSelected = selectedUsers.includes(user.id)
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
                    style={{
                      background: isSelected ? "var(--accent-glow)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "var(--hover-overlay)"
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "transparent"
                    }}
                  >
                    <Avatar name={user.name || user.email} size="sm" />
                    <div className="flex-1 text-left">
                      <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {user.name || user.email.split("@")[0]}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {user.email}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-4 py-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={selectedUsers.length === 0 || isCreating}
          >
            {isCreating ? (
              <>
                <Spinner size="sm" />
                Creating...
              </>
            ) : (
              <>
                <MessageCircle className="h-4 w-4" />
                Start conversation
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

