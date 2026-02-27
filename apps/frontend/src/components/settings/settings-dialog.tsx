import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSettings } from "@/contexts"
import { SETTINGS_TABS, type SettingsTab } from "@threa/types"
import { ProfileSettings } from "./profile-settings"
import { AppearanceSettings } from "./appearance-settings"
import { DateTimeSettings } from "./datetime-settings"
import { NotificationsSettings } from "./notifications-settings"
import { KeyboardSettings } from "./keyboard-settings"
import { AccessibilitySettings } from "./accessibility-settings"

const TAB_LABELS: Record<SettingsTab, string> = {
  profile: "Profile",
  appearance: "Appearance",
  datetime: "Date & Time",
  notifications: "Notifications",
  keyboard: "Keyboard",
  accessibility: "Accessibility",
}

export function SettingsDialog() {
  const { isOpen, activeTab, closeSettings, setActiveTab } = useSettings()
  const [mounted, setMounted] = useState(false)

  // Delay dialog render until after hydration to avoid scroll lock measurement issues
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className="max-w-2xl max-h-[85vh] max-sm:max-h-none sm:flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          {/* Mobile: native select dropdown */}
          <div className="relative sm:hidden">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as SettingsTab)}
              className="w-full h-9 rounded-md border border-input bg-background pl-3 pr-10 text-sm appearance-none"
            >
              {SETTINGS_TABS.map((tab: SettingsTab) => (
                <option key={tab} value={tab}>
                  {TAB_LABELS[tab]}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          {/* Desktop: tab grid */}
          <TabsList className="hidden sm:grid w-full grid-cols-6">
            {SETTINGS_TABS.map((tab: SettingsTab) => (
              <TabsTrigger key={tab} value={tab}>
                {TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="profile" className="mt-0">
              <ProfileSettings />
            </TabsContent>
            <TabsContent value="appearance" className="mt-0">
              <AppearanceSettings />
            </TabsContent>
            <TabsContent value="datetime" className="mt-0">
              <DateTimeSettings />
            </TabsContent>
            <TabsContent value="notifications" className="mt-0">
              <NotificationsSettings />
            </TabsContent>
            <TabsContent value="keyboard" className="mt-0">
              <KeyboardSettings />
            </TabsContent>
            <TabsContent value="accessibility" className="mt-0">
              <AccessibilitySettings />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
