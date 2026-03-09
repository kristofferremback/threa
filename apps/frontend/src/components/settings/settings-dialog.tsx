import { useEffect, useState } from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { ResponsiveTabs } from "@/components/ui/responsive-tabs"
import { Tabs, TabsContent } from "@/components/ui/tabs"
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
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && closeSettings()}>
      <ResponsiveDialogContent
        desktopClassName="max-w-2xl max-h-[85vh] sm:flex flex-col overflow-hidden"
        drawerClassName="flex flex-col"
        hideCloseButton
      >
        <ResponsiveDialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6">
          <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          className="flex-1 flex flex-col overflow-hidden px-4 sm:px-6"
        >
          <ResponsiveTabs
            tabs={SETTINGS_TABS}
            labels={TAB_LABELS}
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as SettingsTab)}
          />

          <div className="flex-1 overflow-y-auto mt-4 pb-4 sm:pb-6">
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
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
