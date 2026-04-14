"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

// ── Defaults ─────────────────────────────────────────────────────────────

/**
 * Default snap points for every pull-up drawer: opens at 80% of the
 * viewport and can be dragged to full screen. Pass `snapPoints={[1]}` to
 * disable the 80% resting state (always full-height), or `snapPoints={null}`
 * to opt out of snap points entirely and use vaul's content-sized default.
 */
const DEFAULT_SNAP_POINTS: (number | string)[] = [0.8, 1]

/**
 * Height of the notch row rendered at the top of every drawer
 * (`mt-4 h-2` → 1.5rem). Subtracted from the snap-point max-height so the
 * scrollable body aligns exactly with the visible bottom edge.
 */
const NOTCH_HEIGHT_REM = 1.5

// ── Snap context ─────────────────────────────────────────────────────────

/**
 * Exposes the active snap point to descendants so `DrawerContent` can bound
 * its inner wrapper to only the visible portion of the viewport. Without this
 * the scroll container would extend past the visible region at any snap < 1
 * and the bottom of content would be permanently off-screen.
 */
const DrawerSnapContext = React.createContext<number | string | null>(null)

// ── Root ─────────────────────────────────────────────────────────────────

type DrawerRootProps = Omit<
  React.ComponentProps<typeof DrawerPrimitive.Root>,
  "snapPoints" | "fadeFromIndex" | "activeSnapPoint" | "setActiveSnapPoint"
> & {
  /**
   * Pass an explicit array to override snap points. Pass `null` to disable
   * snap points entirely. When omitted, defaults to `[0.8, 1]`.
   */
  snapPoints?: (number | string)[] | null
  activeSnapPoint?: number | string | null
  setActiveSnapPoint?: (snapPoint: number | string | null) => void
}

const Drawer = ({
  shouldScaleBackground = true,
  repositionInputs = false,
  snapPoints,
  activeSnapPoint: controlledSnap,
  setActiveSnapPoint: setControlledSnap,
  onOpenChange,
  ...props
}: DrawerRootProps) => {
  // repositionInputs=false disables Vaul's built-in visualViewport keyboard
  // handling which sets inline style.height on the drawer content. This conflicts
  // with our dvh units that already account for the virtual keyboard, causing
  // drawers to shrink to strange sizes after focus/blur cycles on mobile.
  const resolvedSnaps = snapPoints === null ? undefined : (snapPoints ?? DEFAULT_SNAP_POINTS)

  const [internalSnap, setInternalSnap] = React.useState<number | string | null>(
    resolvedSnaps ? resolvedSnaps[0] : null
  )

  const isControlled = controlledSnap !== undefined
  const activeSnap = isControlled ? controlledSnap : internalSnap
  const setActiveSnap = isControlled && setControlledSnap ? setControlledSnap : setInternalSnap

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      // Reset to first snap point whenever the drawer opens so reopening a
      // previously-expanded drawer doesn't show stale state.
      if (open && resolvedSnaps && !isControlled) {
        setInternalSnap(resolvedSnaps[0])
      }
      onOpenChange?.(open)
    },
    [onOpenChange, resolvedSnaps, isControlled]
  )

  return (
    <DrawerSnapContext.Provider value={activeSnap}>
      {resolvedSnaps ? (
        <DrawerPrimitive.Root
          shouldScaleBackground={shouldScaleBackground}
          repositionInputs={repositionInputs}
          snapPoints={resolvedSnaps}
          activeSnapPoint={activeSnap}
          setActiveSnapPoint={setActiveSnap}
          fadeFromIndex={resolvedSnaps.length - 1}
          onOpenChange={handleOpenChange}
          {...props}
        />
      ) : (
        <DrawerPrimitive.Root
          shouldScaleBackground={shouldScaleBackground}
          repositionInputs={repositionInputs}
          onOpenChange={handleOpenChange}
          {...props}
        />
      )}
    </DrawerSnapContext.Provider>
  )
}
Drawer.displayName = "Drawer"

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/80", className)} {...props} />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

// ── Content ──────────────────────────────────────────────────────────────

/**
 * Compute the max-height of the drawer's inner wrapper so it matches only the
 * visible portion at the current snap point. Vaul uses transform-based snap
 * positioning on a 100dvh-tall container, so without this constraint the
 * wrapper (and any scroll container inside) extends past the visible area and
 * the bottom of content is unreachable until the user drags to full screen.
 */
function getSnapMaxHeight(activeSnap: number | string | null): string | undefined {
  if (activeSnap == null) return undefined
  if (typeof activeSnap === "number") {
    if (activeSnap >= 1) return undefined
    return `calc(100dvh * ${activeSnap} - ${NOTCH_HEIGHT_REM}rem)`
  }
  // String snap points (e.g. "400px") — subtract notch height directly.
  return `calc(${activeSnap} - ${NOTCH_HEIGHT_REM}rem)`
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const activeSnap = React.useContext(DrawerSnapContext)
  const innerMaxHeight = getSnapMaxHeight(activeSnap)

  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          // h-[100dvh] is required so vaul's transform-based snap point positioning
          // works correctly — the drawer must be full viewport height so that
          // translate3d(0, offset, 0) controls the visible portion (e.g. 80% at 0.8 snap).
          "fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] flex-col rounded-t-[10px] border bg-background",
          className
        )}
        {...props}
      >
        {/* Notch / drag handle — always pull-down-to-close affordance */}
        <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
        {/* Inner wrapper: bounded to the visible portion of the viewport so
            scrollable descendants can reach the bottom of their content at
            the current snap. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={innerMaxHeight ? { maxHeight: innerMaxHeight } : undefined}
        >
          {children}
        </div>
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
})
DrawerContent.displayName = "DrawerContent"

// ── Body (scrollable region with safe-area bottom padding) ───────────────

/**
 * Scrollable body for a drawer. Handles the three things every pull-up tab
 * needs and that were previously copy-pasted at every call site:
 *  - `flex-1 min-h-0 overflow-y-auto` so it fills the remaining drawer
 *    height and actually scrolls when content overflows.
 *  - `data-vaul-no-drag` so touch scrolling inside the body doesn't get
 *    hijacked by vaul as a drag-to-close gesture.
 *  - bottom padding with safe-area inset so the last item has breathing
 *    room above the home indicator instead of sitting flush with the edge.
 */
const DrawerBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-vaul-no-drag
      className={cn(
        "flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[max(24px,env(safe-area-inset-bottom))]",
        className
      )}
      {...props}
    />
  )
)
DrawerBody.displayName = "DrawerBody"

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("grid shrink-0 gap-1.5 p-4 text-center sm:text-left", className)} {...props} />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto flex shrink-0 flex-col gap-2 p-4", className)} {...props} />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerBody,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
