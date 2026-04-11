import * as React from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./drawer"
import { Button } from "./button"
import { cn } from "@/lib/utils"

// ── Mode context ────────────────────────────────────────────────────────
//
// Every subcomponent needs to know whether it should render the drawer or
// the alert-dialog variant. If each one reads useIsMobile() independently
// they can desync across a single concurrent render pass — the parent ends
// up rendered as <Drawer> while a child still thinks it's in <AlertDialog>
// (or vice versa), and vaul's internal @radix-ui/react-dialog throws
// "DialogPortal must be used within Dialog" because it's a different
// module instance than the one Radix AlertDialog uses.
//
// Fix: read useIsMobile() once at the Root, put the value in a context,
// and have every subcomponent read from the context. One source of truth
// per render pass.

const ResponsiveModeContext = React.createContext<boolean | null>(null)

function useResponsiveMode(): boolean {
  const mode = React.useContext(ResponsiveModeContext)
  if (mode === null) {
    throw new Error("ResponsiveAlertDialog subcomponents must be used inside <ResponsiveAlertDialog>")
  }
  return mode
}

// ── Root ────────────────────────────────────────────────────────────────

interface ResponsiveAlertDialogProps {
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function ResponsiveAlertDialog({ children, ...props }: ResponsiveAlertDialogProps) {
  const isMobile = useIsMobile()

  return (
    <ResponsiveModeContext.Provider value={isMobile}>
      {isMobile ? <Drawer {...props}>{children}</Drawer> : <AlertDialog {...props}>{children}</AlertDialog>}
    </ResponsiveModeContext.Provider>
  )
}

// ── Content ─────────────────────────────────────────────────────────────

const ResponsiveAlertDialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof AlertDialogContent>
>(({ className, children, ...props }, ref) => {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return (
      <DrawerContent
        ref={ref}
        className={cn("max-h-[85dvh]", className)}
        {...(props as React.ComponentPropsWithoutRef<typeof DrawerContent>)}
      >
        {children}
      </DrawerContent>
    )
  }

  return (
    <AlertDialogContent ref={ref} className={className} {...props}>
      {children}
    </AlertDialogContent>
  )
})
ResponsiveAlertDialogContent.displayName = "ResponsiveAlertDialogContent"

// ── Header ──────────────────────────────────────────────────────────────

function ResponsiveAlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return <DrawerHeader className={cn("text-left", className)} {...props} />
  }

  return <AlertDialogHeader className={className} {...props} />
}
ResponsiveAlertDialogHeader.displayName = "ResponsiveAlertDialogHeader"

// ── Footer ──────────────────────────────────────────────────────────────

function ResponsiveAlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return <DrawerFooter className={cn("pb-[max(16px,env(safe-area-inset-bottom))]", className)} {...props} />
  }

  return <AlertDialogFooter className={className} {...props} />
}
ResponsiveAlertDialogFooter.displayName = "ResponsiveAlertDialogFooter"

// ── Title ───────────────────────────────────────────────────────────────

const ResponsiveAlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof AlertDialogTitle>
>(({ className, ...props }, ref) => {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return <DrawerTitle ref={ref} className={className} {...props} />
  }

  return <AlertDialogTitle ref={ref} className={className} {...props} />
})
ResponsiveAlertDialogTitle.displayName = "ResponsiveAlertDialogTitle"

// ── Description ─────────────────────────────────────────────────────────

const ResponsiveAlertDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof AlertDialogDescription>
>(({ className, ...props }, ref) => {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return <DrawerDescription ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  }

  return <AlertDialogDescription ref={ref} className={className} {...props} />
})
ResponsiveAlertDialogDescription.displayName = "ResponsiveAlertDialogDescription"

// ── Action (confirm button) ─────────────────────────────────────────────

const ResponsiveAlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof AlertDialogAction>
>(({ className, ...props }, ref) => {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return (
      <DrawerClose asChild>
        <Button
          ref={ref}
          className={cn("w-full", className)}
          {...props}
          onClick={(e) => {
            if (props.disabled) {
              e.preventDefault()
              return
            }
            props.onClick?.(e)
          }}
        />
      </DrawerClose>
    )
  }

  return <AlertDialogAction ref={ref} className={className} {...props} />
})
ResponsiveAlertDialogAction.displayName = "ResponsiveAlertDialogAction"

// ── Cancel (dismiss button) ─────────────────────────────────────────────

const ResponsiveAlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof AlertDialogCancel>
>(({ className, ...props }, ref) => {
  const isMobile = useResponsiveMode()

  if (isMobile) {
    return (
      <DrawerClose asChild>
        <Button ref={ref} variant="outline" className={cn("w-full", className)} {...props} />
      </DrawerClose>
    )
  }

  return <AlertDialogCancel ref={ref} className={className} {...props} />
})
ResponsiveAlertDialogCancel.displayName = "ResponsiveAlertDialogCancel"

// ── Exports ─────────────────────────────────────────────────────────────

export {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogTitle,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogAction,
  ResponsiveAlertDialogCancel,
}
