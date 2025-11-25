import { useState, useEffect, useRef } from "react"
import { Hash, Lock, AlertTriangle, Loader2, Check } from "lucide-react"
import { Modal, ModalHeader, ModalFooter, Button, Input } from "../ui"
import type { Channel } from "../../types"

interface SlugCheckResult {
  exists: boolean
  slug: string
  slugValid: boolean
  slugError?: string
  isArchived?: boolean
  isPrivate?: boolean
  isMember?: boolean
  channelName?: string
}

interface CreateChannelModalProps {
  open: boolean
  workspaceId: string
  onClose: () => void
  onCreated: (channel: Channel) => void
}

export function CreateChannelModal({ open, workspaceId, onClose, onCreated }: CreateChannelModalProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<"public" | "private">("public")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Slug check state
  const [isCheckingSlug, setIsCheckingSlug] = useState(false)
  const [slugCheck, setSlugCheck] = useState<SlugCheckResult | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Debounced slug check
  useEffect(() => {
    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Reset state if name is empty
    if (!name.trim()) {
      setSlugCheck(null)
      setIsCheckingSlug(false)
      return
    }

    setIsCheckingSlug(true)

    // Debounce the check
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const res = await fetch(
          `/api/workspace/${workspaceId}/channels/check-slug?name=${encodeURIComponent(name.trim())}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        )

        if (!res.ok) {
          throw new Error("Failed to check slug")
        }

        const result = await res.json()
        setSlugCheck(result)
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return // Ignore aborted requests
        }
        console.error("Slug check failed:", err)
        setSlugCheck(null)
      } finally {
        setIsCheckingSlug(false)
      }
    }, 300) // 300ms debounce

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [name, workspaceId])

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setName("")
      setDescription("")
      setVisibility("public")
      setError(null)
      setSlugCheck(null)
      setIsCheckingSlug(false)
    }
  }, [open])

  const handleCreate = async () => {
    if (!name.trim() || isCreating || !slugCheck?.slugValid || slugCheck?.exists) return

    setIsCreating(true)
    setError(null)

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          visibility,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create channel")
      }

      const channel = await res.json()
      onCreated(channel)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && slugCheck?.slugValid && !slugCheck?.exists) {
      e.preventDefault()
      handleCreate()
    }
  }

  const handleClose = () => {
    onClose()
  }

  // Build warning/error message based on slug check result
  const getSlugMessage = (): { message: string; type: "success" | "warning" | "error" } | null => {
    if (!slugCheck) return null

    // Invalid slug (too short, no valid chars, etc.)
    if (!slugCheck.slugValid) {
      return {
        message: slugCheck.slugError || "Invalid channel name",
        type: "error",
      }
    }

    // Slug exists - show appropriate message
    if (slugCheck.exists) {
      if (slugCheck.isArchived) {
        return {
          message: `An archived channel "${slugCheck.channelName}" already uses this name. You'll need to choose a different name or unarchive the existing channel.`,
          type: "error",
        }
      }

      if (slugCheck.isPrivate && !slugCheck.isMember) {
        return {
          message: "A private channel with this name already exists.",
          type: "error",
        }
      }

      return {
        message: `A channel "${slugCheck.channelName}" already exists with this name.`,
        type: "error",
      }
    }

    // Valid and available
    return {
      message: `Channel will be created as #${slugCheck.slug}`,
      type: "success",
    }
  }

  const slugMessage = getSlugMessage()
  const canCreate = name.trim() && slugCheck?.slugValid && !slugCheck?.exists && !isCheckingSlug

  return (
    <Modal open={open} onClose={handleClose}>
      <ModalHeader>Create a channel</ModalHeader>

      <div className="space-y-4">
        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
            Channel name
          </label>
          <div className="relative">
            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--text-muted)" }} />
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="general-discussion"
              autoFocus
              className="pl-9 pr-9"
            />
            {isCheckingSlug && (
              <Loader2
                className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin"
                style={{ color: "var(--text-muted)" }}
              />
            )}
          </div>

          {/* Show slug preview while checking */}
          {name && isCheckingSlug && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Checking availability...
            </p>
          )}

          {/* Success message with checkmark */}
          {!isCheckingSlug && slugMessage?.type === "success" && (
            <p className="mt-1 text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
              {slugMessage.message}
              <Check className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
            </p>
          )}

          {/* Error/warning message */}
          {!isCheckingSlug && slugMessage && slugMessage.type !== "success" && (
            <div
              className="mt-2 p-2 rounded-lg flex items-start gap-2"
              style={{
                background: slugMessage.type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(234, 179, 8, 0.1)",
                border: `1px solid ${slugMessage.type === "error" ? "var(--danger)" : "var(--warning)"}`,
              }}
            >
              <AlertTriangle
                className="h-4 w-4 flex-shrink-0 mt-0.5"
                style={{ color: slugMessage.type === "error" ? "var(--danger)" : "var(--warning)" }}
              />
              <p
                className="text-xs"
                style={{ color: slugMessage.type === "error" ? "var(--danger)" : "var(--warning)" }}
              >
                {slugMessage.message}
              </p>
            </div>
          )}
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

        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
            Visibility
          </label>
          <div className="flex gap-2">
            <VisibilityOption
              icon={<Hash className="h-4 w-4" />}
              label="Public"
              description="Anyone in the workspace can join"
              selected={visibility === "public"}
              onClick={() => setVisibility("public")}
            />
            <VisibilityOption
              icon={<Lock className="h-4 w-4" />}
              label="Private"
              description="Only invited members can see"
              selected={visibility === "private"}
              onClick={() => setVisibility("private")}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate} loading={isCreating} className="flex-1">
            Create Channel
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}

interface VisibilityOptionProps {
  icon: React.ReactNode
  label: string
  description: string
  selected: boolean
  onClick: () => void
}

function VisibilityOption({ icon, label, description, selected, onClick }: VisibilityOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 p-3 rounded-lg text-left transition-all"
      style={{
        background: selected ? "var(--accent-primary)" : "var(--bg-tertiary)",
        border: `1px solid ${selected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: selected ? "white" : "var(--text-muted)" }}>{icon}</span>
        <span className="font-medium text-sm" style={{ color: selected ? "white" : "var(--text-primary)" }}>
          {label}
        </span>
      </div>
      <p className="text-xs" style={{ color: selected ? "rgba(255,255,255,0.8)" : "var(--text-muted)" }}>
        {description}
      </p>
    </button>
  )
}
