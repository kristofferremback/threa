import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MembersTab } from "./members-tab"

const WORKSPACE_SETTINGS_TABS = ["general", "members"] as const
type WorkspaceSettingsTab = (typeof WORKSPACE_SETTINGS_TABS)[number]

const TAB_LABELS: Record<WorkspaceSettingsTab, string> = {
  general: "General",
  members: "Members",
}

interface WorkspaceSettingsDialogProps {
  workspaceId: string
}

export function WorkspaceSettingsDialog({ workspaceId }: WorkspaceSettingsDialogProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [mounted, setMounted] = useState(false)

  const settingsParam = searchParams.get("ws-settings")
  const isOpen = settingsParam !== null
  const activeTab: WorkspaceSettingsTab =
    settingsParam && WORKSPACE_SETTINGS_TABS.includes(settingsParam as WorkspaceSettingsTab)
      ? (settingsParam as WorkspaceSettingsTab)
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            {WORKSPACE_SETTINGS_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="general" className="mt-0">
              <div className="space-y-4 p-1">
                <p className="text-sm text-muted-foreground">Workspace general settings will be available here.</p>
              </div>
            </TabsContent>
            <TabsContent value="members" className="mt-0">
              <MembersTab workspaceId={workspaceId} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
