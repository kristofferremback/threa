"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

/**
 * Height of the notch row rendered at the top of every drawer
 * (`mt-4 h-2` → 1.5rem). Subtracted from the snap-point max-height so the
 * scrollable body aligns exactly with the visible bottom edge.
 */
const NOTCH_HEIGHT_REM = 1.5

/**
 * Exposes the active snap point to `DrawerContent` so it can bound its
 * inner scroll wrapper to the visible portion of the viewport. Null in
 * non-snap mode — DrawerContent sizes itself with CSS (min/max-height) and
 * vaul slides it up naturally.
 */
const DrawerSnapContext = React.createContext<number | string | null>(null)

// ── Root ─────────────────────────────────────────────────────────────────

type DrawerRootProps = Omit<
  React.ComponentProps<typeof DrawerPrimitive.Root>,
  "snapPoints" | "fadeFromIndex" | "activeSnapPoint" | "setActiveSnapPoint"
> & {
  /**
   * Snap points for drag-to-expand behaviour (e.g. `[0.8, 1]`). Omit for
   * an adaptive drawer that sizes to its content between 40dvh and 85dvh
   * via CSS — vaul slides it up from below with no snap-point machinery.
   */
  snapPoints?: (number | string)[]
  activeSnapPoint?: number | string | null
  setActiveSnapPoint?: (snapPoint: number | string | null) => void
}

const Drawer = ({
  shouldScaleBackground = true,
  repositionInputs = false,
  handleOnly = true,
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
  //
  // handleOnly=true restricts drag gestures to the notch (DrawerPrimitive.Handle).
  // Without this, vaul's Content onPointerDown calls setPointerCapture on the
  // touched descendant, which suppresses iOS native momentum/inertia inside any
  // scrollable child (e.g. DrawerBody). With handleOnly, the Content's onPointerDown
  // returns early; scrollable descendants get clean touch events and native fling
  // scrolling works. Drag-to-close still works by grabbing the notch.
  const [internalSnap, setInternalSnap] = React.useState<number | string | null>(snapPoints ? snapPoints[0] : null)

  const isControlled = controlledSnap !== undefined
  const activeSnap = isControlled ? controlledSnap : internalSnap
  const setActiveSnap = isControlled && setControlledSnap ? setControlledSnap : setInternalSnap

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      // Reset to first snap point whenever the drawer opens so reopening a
      // previously-expanded drawer doesn't show stale state.
      if (open && snapPoints && !isControlled) {
        setInternalSnap(snapPoints[0])
      }
      onOpenChange?.(open)
    },
    [onOpenChange, snapPoints, isControlled]
  )

  return (
    <DrawerSnapContext.Provider value={activeSnap}>
      {snapPoints ? (
        <DrawerPrimitive.Root
          shouldScaleBackground={shouldScaleBackground}
          repositionInputs={repositionInputs}
          handleOnly={handleOnly}
          snapPoints={snapPoints}
          activeSnapPoint={activeSnap}
          setActiveSnapPoint={setActiveSnap}
          fadeFromIndex={snapPoints.length - 1}
          onOpenChange={handleOpenChange}
          {...props}
        />
      ) : (
        <DrawerPrimitive.Root
          shouldScaleBackground={shouldScaleBackground}
          repositionInputs={repositionInputs}
          handleOnly={handleOnly}
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
  return `calc(${activeSnap} - ${NOTCH_HEIGHT_REM}rem)`
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const activeSnap = React.useContext(DrawerSnapContext)
  const isSnapped = activeSnap != null
  const innerMaxHeight = getSnapMaxHeight(activeSnap)

  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[10px] border bg-background",
          // Snapped: h-[100dvh] is required so vaul's transform-based snap positioning
          // controls the visible portion. The inner wrapper's max-height is bounded to
          // the current snap so content stays reachable by scrolling at partial snaps.
          // Unsnapped: content-fit between 40dvh and 85dvh. Vaul slides the drawer up
          // from below and it sits at its natural size within those bounds.
          isSnapped ? "h-[100dvh]" : "min-h-[40dvh] max-h-[85dvh]",
          className
        )}
        {...props}
      >
        {/* `DrawerPrimitive.Handle` is the ONLY element vaul wires drag events
            onto when the root has handleOnly=true. Using it (instead of a
            decorative div) is what preserves native momentum scrolling in
            DrawerBody — see the comment on `Drawer` above. The `!` overrides
            are needed because vaul injects explicit dimensions/colors on
            `[data-vaul-handle]` at runtime. */}
        <DrawerPrimitive.Handle preventCycle className="mt-4 shrink-0 !h-2 !w-[100px] !bg-muted !opacity-100" />
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
 * Scrollable body for a drawer. Centralises what every pull-up tab needs:
 *  - `flex-1 min-h-0 overflow-y-auto` so it fills the remaining drawer
 *    height and scrolls when content overflows. `overflow-x-hidden` and
 *    `touch-pan-y` lock panning to the vertical axis — without them the
 *    implicit `overflow-x: auto` side-effect of `overflow-y: auto` absorbs
 *    horizontal touch intent. `touch-pan-y` also overrides vaul's injected
 *    `[data-vaul-drawer]{touch-action:none}` for the scroll region so iOS
 *    momentum/inertia scrolling works.
 *  - bottom padding with safe-area inset so the last item has breathing
 *    room above the home indicator instead of sitting flush with the edge.
 *
 * No `data-vaul-no-drag` needed: the root uses `handleOnly`, so vaul only
 * wires drag events to the Handle component. Touches inside the body never
 * trigger vaul's pointer capture, which is what allows native inertia.
 */
const DrawerBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y pb-[max(24px,env(safe-area-inset-bottom))]",
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
