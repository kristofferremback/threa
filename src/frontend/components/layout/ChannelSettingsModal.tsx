import { useState, useEffect, useRef, useCallback } from "react"
import { Hash, Lock, AlertTriangle, Users, Search, UserMinus } from "lucide-react"
import { Modal, ModalHeader, ModalFooter, Button, Input, Avatar, Spinner, ConfirmModal } from "../ui"
import type { Channel } from "../../types"

interface ChannelMember {
  userId: string
  email: string
  name: string
  role: string
}

interface WorkspaceMember {
  id: string
  email: string
  name: string
}

interface ChannelSettingsModalProps {
  open: boolean
  channel: Channel | null
  workspaceId: string
  currentUserId?: string | null
  isWorkspaceOwner?: boolean
  onClose: () => void
  onUpdated: (channel: Channel) => void
  onArchived: (channelId: string) => void
}

export function ChannelSettingsModal({
  open,
  channel,
  workspaceId,
  currentUserId,
  isWorkspaceOwner = false,
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

  // Members management for private channels
  const [members, setMembers] = useState<ChannelMember[]>([])
  const [isLoadingMembers, setIsLoadingMembers] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"settings" | "members">("settings")

  // Typeahead state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<WorkspaceMember[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Remove member confirmation
  const [memberToRemove, setMemberToRemove] = useState<ChannelMember | null>(null)
  const [isRemovingMember, setIsRemovingMember] = useState(false)

  // Reset form when channel changes
  useEffect(() => {
    if (channel) {
      setName(channel.name.replace("#", ""))
      setTopic(channel.topic || "")
      setDescription(channel.description || "")
      setError(null)
      setShowArchiveConfirm(false)
      setActiveTab("settings")
      setMemberError(null)
      setSearchQuery("")
      setSearchResults([])
      setShowDropdown(false)
      setMemberToRemove(null)

      // Fetch members for all channels
      fetchMembers()
    }
  }, [channel])

  // Debounced search for workspace members
  const searchMembers = useCallback(
    async (query: string) => {
      if (!channel || query.length < 1) {
        setSearchResults([])
        setShowDropdown(false)
        return
      }

      setIsSearching(true)
      try {
        const res = await fetch(
          `/api/workspace/${workspaceId}/members/search?q=${encodeURIComponent(query)}&excludeChannelId=${channel.id}`,
          { credentials: "include" },
        )
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.members || [])
          setShowDropdown(true)
          setSelectedIndex(0)
        }
      } catch (err) {
        console.error("Failed to search members:", err)
      } finally {
        setIsSearching(false)
      }
    },
    [workspaceId, channel],
  )

  // Handle search input change with debounce
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setMemberError(null)

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (value.length >= 1) {
      searchTimeoutRef.current = setTimeout(() => {
        searchMembers(value)
      }, 200)
    } else {
      setSearchResults([])
      setShowDropdown(false)
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const fetchMembers = async () => {
    if (!channel) return

    setIsLoadingMembers(true)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/channels/${channel.id}/members`, {
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
      }
    } catch (err) {
      console.error("Failed to fetch members:", err)
    } finally {
      setIsLoadingMembers(false)
    }
  }

  const handleAddMember = async (member: WorkspaceMember) => {
    if (!channel) return

    setMemberError(null)

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/channels/${channel.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: member.id }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to add member")
      }

      setSearchQuery("")
      setSearchResults([])
      setShowDropdown(false)
      fetchMembers()
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Something went wrong")
    }
  }

  // Handle keyboard navigation in dropdown
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || searchResults.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
        break
      case "Enter":
        e.preventDefault()
        if (searchResults[selectedIndex]) {
          handleAddMember(searchResults[selectedIndex])
        }
        break
      case "Escape":
        setShowDropdown(false)
        break
    }
  }

  const handleRemoveMember = async () => {
    if (!channel || !memberToRemove) return

    setIsRemovingMember(true)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/channels/${channel.id}/members/${memberToRemove.userId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to remove member")
      }

      setMembers((prev) => prev.filter((m) => m.userId !== memberToRemove.userId))
      setMemberToRemove(null)
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setIsRemovingMember(false)
    }
  }

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

  // Permission checks:
  // - Workspace owners can do everything
  // - Channel admins can edit settings (name, description, topic) and archive
  // - All channel members can add other users
  const currentUserMember = members.find((m) => m.userId === currentUserId)
  const isChannelAdmin = currentUserMember?.role === "admin" || currentUserMember?.role === "owner"
  const canEditSettings = isWorkspaceOwner || isChannelAdmin
  const canAddMembers = !!currentUserMember // Any channel member can add others
  const canRemoveMembers = isWorkspaceOwner // Only workspace owners can remove members

  return (
    <Modal open={open} onClose={handleClose}>
      <ModalHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" style={{ color: "var(--text-muted)" }} />
          <span>{canEditSettings ? "Channel settings" : "Channel info"}</span>
        </div>
      </ModalHeader>

      {/* Tabs for all channels */}
      {!showArchiveConfirm && (
        <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>
          <button
            onClick={() => setActiveTab("settings")}
            className="flex-1 px-3 py-1.5 text-sm rounded-md transition-colors"
            style={{
              background: activeTab === "settings" ? "var(--bg-elevated)" : "transparent",
              color: activeTab === "settings" ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {canEditSettings ? "Settings" : "About"}
          </button>
          <button
            onClick={() => setActiveTab("members")}
            className="flex-1 px-3 py-1.5 text-sm rounded-md transition-colors flex items-center justify-center gap-2"
            style={{
              background: activeTab === "members" ? "var(--bg-elevated)" : "transparent",
              color: activeTab === "members" ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <Users className="h-4 w-4" />
            Members {members.length > 0 && `(${members.length})`}
          </button>
        </div>
      )}

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
      ) : activeTab === "members" ? (
        <div className="space-y-4">
          {/* Add member typeahead - any channel member can add others */}
          {canAddMembers && (
            <div className="relative">
              <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
                Add member
              </label>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: "var(--text-muted)" }}
                />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => searchQuery.length >= 1 && searchResults.length > 0 && setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                  placeholder="Search by name or email..."
                  className="pl-9"
                />
                {isSearching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Spinner size="sm" />
                  </div>
                )}
              </div>

              {/* Dropdown results */}
              {showDropdown && searchResults.length > 0 && (
                <div
                  className="absolute z-10 w-full mt-1 rounded-lg shadow-lg overflow-hidden"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
                >
                  {searchResults.map((member, index) => (
                    <button
                      key={member.id}
                      onClick={() => handleAddMember(member)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                      style={{
                        background: index === selectedIndex ? "var(--hover-overlay)" : "transparent",
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <Avatar name={member.email} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                          {member.name || member.email}
                        </p>
                        {member.name && (
                          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                            {member.email}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* No results message */}
              {showDropdown && searchQuery.length >= 1 && searchResults.length === 0 && !isSearching && (
                <div
                  className="absolute z-10 w-full mt-1 rounded-lg shadow-lg p-3 text-center text-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                  }}
                >
                  No members found
                </div>
              )}

              {memberError && (
                <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
                  {memberError}
                </p>
              )}
            </div>
          )}

          {/* Members list */}
          <div>
            <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              Members ({members.length})
            </label>
            {isLoadingMembers ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
                No members yet
              </p>
            ) : (
              <div
                className="rounded-lg divide-y overflow-hidden max-h-64 overflow-y-auto"
                style={{ background: "var(--bg-tertiary)", borderColor: "var(--border-subtle)" }}
              >
                {members.map((member) => (
                  <div key={member.userId} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={member.email} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                          {member.name || member.email}
                          {member.role === "admin" || member.role === "owner" ? (
                            <span
                              className="ml-2 text-xs px-1.5 py-0.5 rounded"
                              style={{ background: "var(--accent-primary)", color: "white" }}
                            >
                              {member.role}
                            </span>
                          ) : null}
                        </p>
                        {member.name && (
                          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                            {member.email}
                          </p>
                        )}
                      </div>
                    </div>
                    {canRemoveMembers && member.userId !== currentUserId && (
                      <button
                        onClick={() => setMemberToRemove(member)}
                        className="p-1.5 rounded transition-colors flex-shrink-0"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                        title="Remove member"
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 flex justify-end" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <Button variant="secondary" onClick={handleClose}>
              Done
            </Button>
          </div>
        </div>
      ) : canEditSettings ? (
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
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              Channel name
            </label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>
              <Icon className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
              <span style={{ color: "var(--text-primary)" }}>{channel.name.replace("#", "")}</span>
            </div>
          </div>

          {channel.topic && (
            <div>
              <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
                Topic
              </label>
              <p className="px-3 py-2 rounded-lg" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
                {channel.topic}
              </p>
            </div>
          )}

          {channel.description && (
            <div>
              <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
                Description
              </label>
              <p className="px-3 py-2 rounded-lg" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
                {channel.description}
              </p>
            </div>
          )}

          {!channel.topic && !channel.description && (
            <p className="text-sm py-2" style={{ color: "var(--text-muted)" }}>
              No topic or description set for this channel.
            </p>
          )}

          <div className="pt-4 flex justify-end" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={memberToRemove !== null}
        onClose={() => setMemberToRemove(null)}
        onConfirm={handleRemoveMember}
        title={`Remove ${memberToRemove?.name || memberToRemove?.email}?`}
        description={
          <>
            They will no longer have access to <strong>#{channel?.name.replace("#", "")}</strong> and won't be able to
            see any messages in this channel.
          </>
        }
        confirmText="Remove"
        variant="danger"
        icon="user-minus"
        isLoading={isRemovingMember}
      />
    </Modal>
  )
}
