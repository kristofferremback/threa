import * as React from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer"
import { cn } from "@/lib/utils"

// ── Root ────────────────────────────────────────────────────────────────

interface ResponsiveDialogProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Override snap points for the mobile drawer (e.g. `[0.8, 1]` for
   * drag-to-expand). Omit for an adaptive drawer that sizes to content
   * between 40dvh and 85dvh.
   */
  snapPoints?: (number | string)[]
}

function ResponsiveDialog({ children, snapPoints, ...props }: ResponsiveDialogProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={props.onOpenChange} snapPoints={snapPoints}>
        {children}
      </Drawer>
    )
  }

  return <Dialog {...props}>{children}</Dialog>
}

// ── Trigger ─────────────────────────────────────────────────────────────

const ResponsiveDialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogTrigger>
>(({ className, ...props }, ref) => {
  const isMobile = useIsMobile()
  const Comp = isMobile ? DrawerTrigger : DialogTrigger
  return <Comp ref={ref} className={className} {...props} />
})
ResponsiveDialogTrigger.displayName = "ResponsiveDialogTrigger"

// ── Close ───────────────────────────────────────────────────────────────

const ResponsiveDialogClose = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof DialogClose>>(
  ({ className, ...props }, ref) => {
    const isMobile = useIsMobile()
    const Comp = isMobile ? DrawerClose : DialogClose
    return <Comp ref={ref} className={className} {...props} />
  }
)
ResponsiveDialogClose.displayName = "ResponsiveDialogClose"

// ── Content ─────────────────────────────────────────────────────────────

interface ResponsiveDialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogContent> {
  /** Class applied only on desktop Dialog */
  desktopClassName?: string
  /** Class applied only on mobile Drawer */
  drawerClassName?: string
}

const ResponsiveDialogContent = React.forwardRef<HTMLDivElement, ResponsiveDialogContentProps>(
  ({ className, desktopClassName, drawerClassName, children, hideCloseButton, ...props }, ref) => {
    const isMobile = useIsMobile()

    if (isMobile) {
      // DrawerContent owns h-[100dvh] and the snap-aware inner wrapper internally.
      return (
        <DrawerContent ref={ref} className={cn(drawerClassName, className)} {...props}>
          {children}
        </DrawerContent>
      )
    }

    // DialogContent already renders its own Portal + Overlay internally
    return (
      <DialogContent ref={ref} className={cn(desktopClassName, className)} hideCloseButton={hideCloseButton} {...props}>
        {children}
      </DialogContent>
    )
  }
)
ResponsiveDialogContent.displayName = "ResponsiveDialogContent"

// ── Header ──────────────────────────────────────────────────────────────

function ResponsiveDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    // Override DrawerHeader's default p-4 to avoid double padding — callers set their own px/pt
    return <DrawerHeader className={cn("text-left p-0 px-4 pb-2", className)} {...props} />
  }

  return <DialogHeader className={className} {...props} />
}
ResponsiveDialogHeader.displayName = "ResponsiveDialogHeader"

// ── Footer ──────────────────────────────────────────────────────────────

function ResponsiveDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <DrawerFooter className={cn("pb-[max(16px,env(safe-area-inset-bottom))]", className)} {...props} />
  }

  return <DialogFooter className={className} {...props} />
}
ResponsiveDialogFooter.displayName = "ResponsiveDialogFooter"

// ── Title ───────────────────────────────────────────────────────────────

const ResponsiveDialogTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<typeof DialogTitle>>(
  ({ className, ...props }, ref) => {
    const isMobile = useIsMobile()

    if (isMobile) {
      return <DrawerTitle ref={ref} className={className} {...props} />
    }

    return <DialogTitle ref={ref} className={className} {...props} />
  }
)
ResponsiveDialogTitle.displayName = "ResponsiveDialogTitle"

// ── Description ─────────────────────────────────────────────────────────

const ResponsiveDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof DialogDescription>
>(({ className, ...props }, ref) => {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <DrawerDescription ref={ref} className={className} {...props} />
  }

  return <DialogDescription ref={ref} className={className} {...props} />
})
ResponsiveDialogDescription.displayName = "ResponsiveDialogDescription"

// ── Body (scrollable content area) ──────────────────────────────────────

function ResponsiveDialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    // DrawerBody handles the scroll wrapper + safe-area bottom padding so
    // content is reachable at any snap point.
    return <DrawerBody className={cn("px-4 sm:px-6", className)} {...props} />
  }

  return <div className={cn("flex-1 overflow-y-auto px-4 sm:px-6", className)} {...props} />
}
ResponsiveDialogBody.displayName = "ResponsiveDialogBody"

// ── Exports ─────────────────────────────────────────────────────────────

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
}
