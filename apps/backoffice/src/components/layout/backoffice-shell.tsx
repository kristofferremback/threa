import { type ReactNode } from "react"
import { Link, NavLink, Outlet } from "react-router-dom"
import { LogOut, UserPlus, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/auth"
import { cn } from "@/lib/utils"

/**
 * Persistent chrome for the backoffice: top bar with identity + sign out,
 * and a left rail for the (growing) list of admin sections. New sections
 * (billing, users, audits, …) plug into NAV_ITEMS below.
 */
const NAV_ITEMS: Array<{ to: string; label: string; icon: ReactNode; end?: boolean }> = [
  { to: "/", label: "Welcome", icon: <LayoutDashboard className="size-4" />, end: true },
  { to: "/invites/workspace-owners", label: "Workspace owner invites", icon: <UserPlus className="size-4" /> },
]

export function BackofficeShell() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link to="/" className="flex items-center gap-3">
          <span className="text-sm uppercase tracking-[0.2em] text-primary">Threa</span>
          <span className="text-sm text-muted-foreground">Backoffice</span>
        </Link>
        <div className="flex items-center gap-3">
          {user ? <span className="text-sm text-muted-foreground">{user.email}</span> : null}
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        <nav aria-label="Backoffice sections" className="w-60 border-r px-3 py-6">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex-1 px-8 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
