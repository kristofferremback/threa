import { ReactNode } from "react"

interface AppShellProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="relative z-50 flex h-full w-64 flex-shrink-0 flex-col border-r bg-muted/30">{sidebar}</aside>
      <main className="flex h-full flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
