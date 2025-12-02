import { useState } from "react"
import { X, Bell, BellOff, Volume2, VolumeX, AtSign } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Modal, ModalHeader } from "../ui"
import { ThemeSelector } from "../ui/ThemeToggle"
import { settingsApi, type UserSettings } from "../../../shared/api/settings-api"

interface UserSettingsModalProps {
  isOpen: boolean
  workspaceId: string
  onClose: () => void
}

export function UserSettingsModal({ isOpen, workspaceId, onClose }: UserSettingsModalProps) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["settings", workspaceId],
    queryFn: () => settingsApi.getSettings(workspaceId),
    enabled: isOpen && Boolean(workspaceId),
  })

  const settings = data?.settings

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<UserSettings>) => settingsApi.updateSettings(workspaceId, updates),
    onSuccess: (newData) => {
      queryClient.setQueryData(["settings", workspaceId], newData)
    },
  })

  const updateNotification = (key: keyof NonNullable<UserSettings["notifications"]>, value: boolean) => {
    updateMutation.mutate({
      notifications: {
        ...settings?.notifications,
        [key]: value,
      },
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <div className="flex items-center justify-between mb-6">
        <ModalHeader>Settings</ModalHeader>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center" style={{ color: "var(--text-muted)" }}>
          Loading settings...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Theme Section */}
          <section>
            <h3
              className="text-sm font-medium uppercase tracking-wider mb-3"
              style={{ color: "var(--text-muted)" }}
            >
              Appearance
            </h3>
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
            >
              <ThemeSelector />
            </div>
          </section>

          {/* Notifications Section */}
          <section>
            <h3
              className="text-sm font-medium uppercase tracking-wider mb-3"
              style={{ color: "var(--text-muted)" }}
            >
              Notifications
            </h3>
            <div
              className="rounded-lg divide-y divide-[var(--border-subtle)] overflow-hidden"
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <NotificationToggle
                icon={Bell}
                activeIcon={BellOff}
                label="Desktop notifications"
                description="Show browser notifications for new messages"
                enabled={settings?.notifications?.desktop ?? true}
                onChange={(v) => updateNotification("desktop", v)}
              />
              <NotificationToggle
                icon={Volume2}
                activeIcon={VolumeX}
                label="Sound notifications"
                description="Play a sound for new messages"
                enabled={settings?.notifications?.sound ?? true}
                onChange={(v) => updateNotification("sound", v)}
              />
              <NotificationToggle
                icon={AtSign}
                activeIcon={AtSign}
                label="Mention notifications"
                description="Get notified when someone mentions you"
                enabled={settings?.notifications?.mentions ?? true}
                onChange={(v) => updateNotification("mentions", v)}
              />
            </div>
          </section>

          {/* Sidebar Section (info only) */}
          <section>
            <h3
              className="text-sm font-medium uppercase tracking-wider mb-3"
              style={{ color: "var(--text-muted)" }}
            >
              Sidebar
            </h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Click section headers to soft-collapse (show only unread).
              Right-click to fully collapse sections.
            </p>
          </section>
        </div>
      )}
    </Modal>
  )
}

interface NotificationToggleProps {
  icon: typeof Bell
  activeIcon: typeof BellOff
  label: string
  description: string
  enabled: boolean
  onChange: (value: boolean) => void
}

function NotificationToggle({
  icon: Icon,
  activeIcon: ActiveIcon,
  label,
  description,
  enabled,
  onChange,
}: NotificationToggleProps) {
  const CurrentIcon = enabled ? Icon : ActiveIcon

  return (
    <button
      onClick={() => onChange(!enabled)}
      className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <CurrentIcon
        className="h-5 w-5 mt-0.5 flex-shrink-0"
        style={{ color: enabled ? "var(--accent-primary)" : "var(--text-muted)" }}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium" style={{ color: "var(--text-primary)" }}>
          {label}
        </div>
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          {description}
        </div>
      </div>
      <div
        className={`w-10 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${enabled ? "justify-end" : "justify-start"}`}
        style={{
          background: enabled ? "var(--accent-primary)" : "var(--bg-primary)",
          padding: "2px",
        }}
      >
        <div
          className="w-5 h-5 rounded-full shadow"
          style={{ background: "white" }}
        />
      </div>
    </button>
  )
}
