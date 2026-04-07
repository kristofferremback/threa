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
import { AISettings } from "./ai-settings"
import { ProfileSettings } from "./profile-settings"
import { AppearanceSettings } from "./appearance-settings"
import { DateTimeSettings } from "./datetime-settings"
import { NotificationsSettings } from "./notifications-settings"
import { KeyboardSettings } from "./keyboard-settings"
import { AccessibilitySettings } from "./accessibility-settings"

const TAB_CONFIG: Record<SettingsTab, { label: string; description: string }> = {
  profile: { label: "Profile", description: "Identity and account details" },
  ai: { label: "AI", description: "Scratchpad behavior and guidance" },
  appearance: { label: "Appearance", description: "Theme and message density" },
  datetime: { label: "Date & Time", description: "Timezone and formatting" },
  notifications: { label: "Notifications", description: "Alerts and push behavior" },
  keyboard: { label: "Keyboard", description: "Shortcuts and send behavior" },
  accessibility: { label: "Accessibility", description: "Motion, contrast, and fonts" },
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
        desktopClassName="w-[min(96vw,980px)] max-w-none h-[min(720px,calc(100vh-2rem))] sm:flex flex-col overflow-hidden p-0 gap-0"
        drawerClassName="flex flex-col gap-0"
        hideCloseButton
      >
        <ResponsiveDialogHeader className="border-b px-4 py-4 sm:px-6 sm:py-5">
          <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          className="flex-1 min-h-0"
        >
          <div className="flex-1 min-h-0 sm:grid sm:grid-cols-[220px,minmax(0,1fr)]">
            <ResponsiveTabs
              tabs={SETTINGS_TABS}
              labels={
                Object.fromEntries(SETTINGS_TABS.map((tab) => [tab, TAB_CONFIG[tab].label])) as Record<
                  SettingsTab,
                  string
                >
              }
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as SettingsTab)}
            >
              <div className="hidden sm:flex h-full flex-col border-r bg-muted/20 p-3">
                {SETTINGS_TABS.map((tab) => {
                  const isActive = tab === activeTab
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-xl px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/70"
                      }`}
                    >
                      <div className="text-sm font-medium">{TAB_CONFIG[tab].label}</div>
                      <div className="mt-0.5 text-xs">{TAB_CONFIG[tab].description}</div>
                    </button>
                  )
                })}
              </div>
            </ResponsiveTabs>

            <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:py-6">
              <TabsContent value="profile" className="mt-0">
                <ProfileSettings />
              </TabsContent>
              <TabsContent value="ai" className="mt-0">
                <AISettings />
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
          </div>
        </Tabs>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
