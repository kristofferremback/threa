"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

// ── Adaptive sizing bounds ───────────────────────────────────────────────

/**
 * Adaptive pull-ups open just tall enough to show their content, clamped
 * between 40% and 85% of the viewport so they never feel cramped or take
 * over the whole screen by default. Users can always drag up to full
 * screen (the second snap point). Callers opt out by passing explicit
 * `snapPoints` (e.g. `[0.8, 1]`) or `snapPoints={null}` to disable snaps
 * entirely.
 */
const ADAPTIVE_MIN_VH = 0.4
const ADAPTIVE_MAX_VH = 0.85
const ADAPTIVE_FALLBACK_SNAP = `${Math.round(ADAPTIVE_MIN_VH * 100)}dvh`

/**
 * Height of the notch row rendered at the top of every drawer
 * (`mt-4 h-2` → 1.5rem). Subtracted from the snap-point max-height so the
 * scrollable body aligns exactly with the visible bottom edge.
 */
const NOTCH_HEIGHT_REM = 1.5
const REM_PX = 16
const NOTCH_PX = NOTCH_HEIGHT_REM * REM_PX

function clampToAdaptiveRange(pixels: number): number {
  const vh = typeof window === "undefined" ? 800 : window.innerHeight
  const min = vh * ADAPTIVE_MIN_VH
  const max = vh * ADAPTIVE_MAX_VH
  return Math.round(Math.max(min, Math.min(max, pixels)))
}

// ── Snap context ─────────────────────────────────────────────────────────

/**
 * Exposes the active snap point to descendants so `DrawerContent` can bound
 * its inner wrapper to only the visible portion of the viewport, and lets
 * the wrapper report its measured content height back up to the root so
 * the first snap can be sized adaptively.
 */
interface DrawerSnapContextValue {
  activeSnap: number | string | null
  isAdaptive: boolean
  /**
   * Called by `DrawerContent` with the natural content height in pixels
   * (notch excluded). No-op when the caller passed explicit snap points.
   */
  reportContentHeight: (pixels: number) => void
}

const DrawerSnapContext = React.createContext<DrawerSnapContextValue>({
  activeSnap: null,
  isAdaptive: false,
  reportContentHeight: () => {},
})

// ── Root ─────────────────────────────────────────────────────────────────

type DrawerRootProps = Omit<
  React.ComponentProps<typeof DrawerPrimitive.Root>,
  "snapPoints" | "fadeFromIndex" | "activeSnapPoint" | "setActiveSnapPoint"
> & {
  /**
   * Explicit snap points. Omit (undefined) for adaptive sizing clamped to
   * `[40dvh, 85dvh]` based on measured content. Pass an explicit array to
   * override (e.g. `[0.8, 1]`). Pass `null` to disable snaps entirely.
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
  const isAdaptive = snapPoints === undefined
  const [adaptiveSnap, setAdaptiveSnap] = React.useState<string>(ADAPTIVE_FALLBACK_SNAP)

  const resolvedSnaps = React.useMemo<(number | string)[] | undefined>(() => {
    if (snapPoints === null) return undefined
    if (!isAdaptive) return snapPoints
    return [adaptiveSnap, 1]
  }, [snapPoints, isAdaptive, adaptiveSnap])

  const [internalSnap, setInternalSnap] = React.useState<number | string | null>(
    resolvedSnaps ? resolvedSnaps[0] : null
  )

  // When the adaptive first snap updates (after content measurement), keep
  // internalSnap aligned unless the user has already dragged to full screen.
  React.useEffect(() => {
    if (!isAdaptive) return
    setInternalSnap((prev) => (prev === 1 ? prev : adaptiveSnap))
  }, [isAdaptive, adaptiveSnap])

  const isControlled = controlledSnap !== undefined
  const activeSnap = isControlled ? controlledSnap : internalSnap
  const setActiveSnap = isControlled && setControlledSnap ? setControlledSnap : setInternalSnap

  const reportContentHeight = React.useCallback(
    (pixels: number) => {
      if (!isAdaptive) return
      // Visible drawer = content + notch. Clamp the total so the drawer
      // never exceeds 85vh or falls below 40vh, then feed it back as the
      // first snap point. ResizeObserver guarantees this settles into a
      // fixed point even as `max-height` mutates the wrapper size.
      const next = `${clampToAdaptiveRange(pixels + NOTCH_PX)}px`
      setAdaptiveSnap((prev) => (prev === next ? prev : next))
    },
    [isAdaptive]
  )

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

  const snapContext = React.useMemo<DrawerSnapContextValue>(
    () => ({ activeSnap, isAdaptive, reportContentHeight }),
    [activeSnap, isAdaptive, reportContentHeight]
  )

  return (
    <DrawerSnapContext.Provider value={snapContext}>
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
  const { activeSnap, isAdaptive, reportContentHeight } = React.useContext(DrawerSnapContext)
  const innerMaxHeight = getSnapMaxHeight(activeSnap)
  const innerRef = React.useRef<HTMLDivElement>(null)

  // In adaptive mode, watch the wrapper's natural content height and report
  // it up so the root can size the first snap point to match. With
  // `height: fit-content` the wrapper's scrollHeight reflects the natural
  // content height (content extent, unclipped by max-height), which lets
  // the root settle to a snap point that visually matches the content.
  React.useLayoutEffect(() => {
    if (!isAdaptive) return
    const el = innerRef.current
    if (!el) return
    const measure = () => reportContentHeight(el.scrollHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [isAdaptive, reportContentHeight])

  // Adaptive mode: `fit-content` + min/max bounds the wrapper to content
  // natural height, clamped. The root's snap point matches these bounds so
  // the drawer visually sizes to content without empty space below the
  // wrapper (except when content is below the 40vh floor — expected).
  // Fixed mode: flex-1 fills the drawer at the configured snap height.
  let wrapperStyle: React.CSSProperties | undefined
  if (isAdaptive) {
    wrapperStyle = {
      maxHeight: innerMaxHeight,
      minHeight: `calc(${Math.round(ADAPTIVE_MIN_VH * 100)}dvh - ${NOTCH_HEIGHT_REM}rem)`,
      height: "fit-content",
    }
  } else if (innerMaxHeight) {
    wrapperStyle = { maxHeight: innerMaxHeight }
  }

  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          // h-[100dvh] is required so vaul's transform-based snap point positioning
          // works correctly — the drawer must be full viewport height so that
          // translate3d(0, offset, 0) controls the visible portion.
          "fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] flex-col rounded-t-[10px] border bg-background",
          className
        )}
        {...props}
      >
        <div className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
        <div
          ref={innerRef}
          className={cn("flex min-h-0 flex-col", isAdaptive ? undefined : "flex-1")}
          style={wrapperStyle}
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
 *    height and actually scrolls when content overflows. `overflow-x-hidden`
 *    and `touch-pan-y` lock panning to the vertical axis — without them
 *    the implicit `overflow-x: auto` side-effect of `overflow-y: auto`
 *    absorbs horizontal touch intent and defeats momentum scrolling.
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
