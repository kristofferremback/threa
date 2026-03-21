import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { ResponsiveTabs } from "@/components/ui/responsive-tabs"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { GeneralTab } from "./general-tab"
import { UsersTab } from "./users-tab"
import { ApiKeysTab } from "./api-keys-tab"
import { useCurrentWorkspaceUser } from "@/hooks/use-workspaces"

const ALL_TABS = ["general", "users", "api-keys"] as const
type WorkspaceSettingsTab = (typeof ALL_TABS)[number]

const TAB_LABELS: Record<WorkspaceSettingsTab, string> = {
  general: "General",
  users: "Users",
  "api-keys": "API Keys",
}

interface WorkspaceSettingsDialogProps {
  workspaceId: string
}

export function WorkspaceSettingsDialog({ workspaceId }: WorkspaceSettingsDialogProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const currentUser = useCurrentWorkspaceUser(workspaceId)
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner"

  const visibleTabs: readonly WorkspaceSettingsTab[] = useMemo(
    () => (isAdmin ? ALL_TABS : ALL_TABS.filter((t) => t !== "api-keys")),
    [isAdmin]
  )

  const settingsParam = searchParams.get("ws-settings")
  const normalizedSettingsParam = settingsParam === "members" ? "users" : settingsParam
  const isOpen = settingsParam !== null
  const activeTab: WorkspaceSettingsTab =
    normalizedSettingsParam && visibleTabs.includes(normalizedSettingsParam as WorkspaceSettingsTab)
      ? (normalizedSettingsParam as WorkspaceSettingsTab)
      : "general"

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const close = () => {
    const newParams = new URLSearchParams(searchParams)
    newParams.delete("ws-settings")
    setSearchParams(newParams, { replace: true })
  }

  const setTab = (tab: string) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set("ws-settings", tab)
    setSearchParams(newParams, { replace: true })
  }

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <ResponsiveDialogContent
        desktopClassName="max-w-2xl max-h-[85vh] sm:flex flex-col overflow-hidden"
        drawerClassName="flex flex-col"
        hideCloseButton
      >
        <ResponsiveDialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6">
          <ResponsiveDialogTitle>Workspace Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <Tabs value={activeTab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0 px-4 sm:px-6">
          <ResponsiveTabs tabs={visibleTabs} labels={TAB_LABELS} value={activeTab} onValueChange={setTab} />

          <div className="flex-1 overflow-y-auto mt-4 pb-4 sm:pb-6">
            <TabsContent value="general" className="mt-0">
              <GeneralTab workspaceId={workspaceId} />
            </TabsContent>
            <TabsContent value="users" className="mt-0">
              <UsersTab workspaceId={workspaceId} />
            </TabsContent>
            {isAdmin && (
              <TabsContent value="api-keys" className="mt-0">
                <ApiKeysTab workspaceId={workspaceId} />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
