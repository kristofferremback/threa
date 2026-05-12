import { useState } from "react"
import { Plus, RefreshCcw, X } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/auth"
import type { AccountSummary } from "@/auth/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { getInitials } from "@/lib/initials"
import { cn } from "@/lib/utils"

interface AccountSwitcherDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function statusLabel(status: AccountSummary["status"]): string {
  if (status === "active") return "Active"
  if (status === "dead") return "Re-authenticate"
  return "Switch"
}

export function AccountSwitcherDialog({ open, onOpenChange }: AccountSwitcherDialogProps) {
  const { accounts, maxAccounts, switchAccount, removeAccount, addAccount } = useAuth()
  const [busySlot, setBusySlot] = useState<string | null>(null)

  // The active account always renders first; parked accounts follow in slot order.
  const active = accounts.find((a) => a.slot === "active") ?? null
  const parked = accounts.filter((a) => a.slot !== "active").sort((a, b) => Number(a.slot) - Number(b.slot))
  const canAddMore = accounts.length < maxAccounts

  const handleSwitch = async (account: AccountSummary) => {
    if (typeof account.slot !== "number") return
    if (account.status === "dead") {
      // Re-auth via the OAuth add flow — server coalesces by userId so the slot
      // gets refreshed in place rather than creating a duplicate.
      addAccount()
      return
    }
    setBusySlot(String(account.slot))
    try {
      await switchAccount(account.slot)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch accounts")
      setBusySlot(null)
    }
  }

  const handleRemove = async (account: AccountSummary) => {
    setBusySlot(String(account.slot))
    try {
      await removeAccount(account.slot)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove account")
      setBusySlot(null)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="sm:max-w-md"
        drawerClassName="px-0"
        aria-describedby="account-switcher-description"
      >
        <ResponsiveDialogHeader className="px-4 pt-2 sm:px-6 sm:pt-0">
          <ResponsiveDialogTitle>Switch account</ResponsiveDialogTitle>
          <ResponsiveDialogDescription id="account-switcher-description">
            You have {accounts.length} of {maxAccounts} accounts active in this browser.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex flex-col gap-1 px-2 pb-4 sm:px-4 sm:pb-2">
          {active && <AccountRow account={active} busy={busySlot === "active"} onRemove={handleRemove} />}
          {parked.map((account) => (
            <AccountRow
              key={String(account.slot)}
              account={account}
              busy={busySlot === String(account.slot)}
              onSwitch={handleSwitch}
              onRemove={handleRemove}
              actionLabel={statusLabel(account.status)}
            />
          ))}

          <Button
            type="button"
            variant="ghost"
            className="mt-1 justify-start gap-3 px-3"
            disabled={!canAddMore}
            onClick={() => addAccount()}
          >
            <Plus className="h-4 w-4" />
            {canAddMore ? "Add another account" : "Maximum accounts reached"}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

interface AccountRowProps {
  account: AccountSummary
  busy: boolean
  onSwitch?: (account: AccountSummary) => void | Promise<void>
  onRemove: (account: AccountSummary) => void | Promise<void>
  actionLabel?: string
}

function AccountRow({ account, busy, onSwitch, onRemove, actionLabel }: AccountRowProps) {
  const isActive = account.slot === "active"
  const isDead = account.status === "dead"
  const displayName = account.name ?? account.email ?? "Unknown user"
  const displaySecondary = account.email && account.name ? account.email : null

  return (
    <div className={cn("flex items-center gap-3 rounded-lg px-3 py-2", isActive ? "bg-muted/60" : "hover:bg-muted/40")}>
      <Avatar className="h-9 w-9">
        <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
        {displaySecondary && <p className="truncate text-xs text-muted-foreground">{displaySecondary}</p>}
        {isDead && <p className="text-xs text-amber-600 dark:text-amber-500">Session expired</p>}
      </div>

      {isActive ? (
        <span className="text-xs text-muted-foreground">Active</span>
      ) : (
        onSwitch && (
          <Button
            type="button"
            size="sm"
            variant={isDead ? "outline" : "default"}
            disabled={busy}
            onClick={() => onSwitch(account)}
          >
            {isDead && <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
            {actionLabel ?? "Switch"}
          </Button>
        )
      )}

      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={isActive ? "Sign out of this account" : "Remove this account"}
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        disabled={busy}
        onClick={() => onRemove(account)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
