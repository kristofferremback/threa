import { type ReactNode } from "react"
import { Link, NavLink, Outlet } from "react-router-dom"
import { LogOut, LayoutDashboard, Users, MailPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/auth"
import { cn } from "@/lib/utils"

/**
 * Persistent chrome for the backoffice. On desktop (md+) it's a standard
 * top-bar + left-rail layout. On mobile the left rail becomes a horizontal
 * scroll strip directly under the header — just three nav items, so a
 * drawer/sheet would be overkill.
 */
const NAV_ITEMS: Array<{ to: string; label: string; icon: ReactNode; end?: boolean }> = [
  { to: "/", label: "Overview", icon: <LayoutDashboard className="size-4" />, end: true },
  // `end` is omitted so NavLink treats `/workspaces/:id` as active too.
  { to: "/workspaces", label: "Workspaces", icon: <Users className="size-4" /> },
  { to: "/invites/workspace-owners", label: "Invitations", icon: <MailPlus className="size-4" /> },
]

export function BackofficeShell() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 md:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2 md:gap-3">
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Threa</span>
          <span className="hidden truncate text-sm text-muted-foreground sm:inline">Backoffice</span>
        </Link>
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          {user ? (
            <span className="hidden min-w-0 max-w-[40vw] truncate text-sm text-muted-foreground md:inline">
              {user.email}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      {/* Mobile nav — horizontal strip under the header, collapses on md+. */}
      <nav aria-label="Backoffice sections" className="border-b px-2 py-2 md:hidden">
        <ul className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => mobileNavLinkClass(isActive)}>
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-1 flex-col md:flex-row">
        {/* Desktop rail — left side, only md+. */}
        <nav aria-label="Backoffice sections" className="hidden w-60 shrink-0 border-r px-3 py-6 md:block">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => railNavLinkClass(isActive)}>
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function railNavLinkClass(isActive: boolean): string {
  return cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  )
}

function mobileNavLinkClass(isActive: boolean): string {
  return cn(
    "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  )
}
