import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  X,
  Download,
  Copy,
  ChevronLeft,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  Play,
} from "lucide-react"
import { downloadImage, copyImage } from "@/lib/image-utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { attachmentsApi } from "@/api"
import { triggerDownload } from "@/lib/image-utils"

export type GalleryItem =
  | { type: "image"; url: string; filename: string; attachmentId: string }
  | { type: "video"; url: string; thumbnailUrl: string; filename: string; attachmentId: string }

interface MediaGalleryProps {
  isOpen: boolean
  onClose: () => void
  items: GalleryItem[]
  initialIndex: number
  workspaceId: string
  /** Called when the user navigates to a different item. Used to sync the URL
   *  permalink and trigger lazy URL fetching for the newly-current item. */
  onItemChange?: (attachmentId: string) => void
}

function GalleryVideo({ current }: { current: Extract<GalleryItem, { type: "video" }> }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Focus the video on mount/URL-ready so keyboard controls (space to play,
  // arrow keys for seek) work immediately. Without this the Dialog places
  // initial focus on the first focusable child (download button), which
  // steals space-bar toggling from the video.
  useEffect(() => {
    if (current.url) videoRef.current?.focus({ preventScroll: true })
  }, [current.url, current.attachmentId])

  return (
    <video
      ref={videoRef}
      key={current.attachmentId}
      src={current.url}
      poster={current.thumbnailUrl || undefined}
      controls
      controlsList="nodownload"
      tabIndex={-1}
      className="max-w-full max-h-full object-contain select-none outline-none"
    />
  )
}

function GalleryMediaContent({ current, isActive = true }: { current: GalleryItem; isActive?: boolean }) {
  if (current.type === "video") {
    // Non-active video slides show poster so the <video> element doesn't load
    if (!isActive) {
      return current.thumbnailUrl ? (
        <img
          src={current.thumbnailUrl}
          alt={current.filename}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
      ) : (
        <div className="h-16 w-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
          <Play className="h-7 w-7 text-white/60 ml-0.5" fill="currentColor" />
        </div>
      )
    }
    if (!current.url)
      return (
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
            <Play className="h-7 w-7 text-white/60 ml-0.5" fill="currentColor" />
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-white/40" />
        </div>
      )
    return <GalleryVideo current={current} />
  }
  if (!current.url) return <Loader2 className="h-8 w-8 animate-spin text-white/50" />
  return (
    <img
      src={current.url}
      alt={current.filename}
      className="max-w-full max-h-full object-contain select-none"
      draggable={false}
    />
  )
}

function GalleryThumbnailContent({ item }: { item: GalleryItem }) {
  if (item.type === "video") {
    if (!item.thumbnailUrl) {
      return (
        <div className="w-full h-20 flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5">
          <div className="h-7 w-7 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
            <Play className="h-3.5 w-3.5 text-white/60 ml-px" fill="currentColor" />
          </div>
        </div>
      )
    }
    return (
      <div className="relative">
        <img
          src={item.thumbnailUrl}
          alt={item.filename}
          className="w-full h-20 object-cover"
          loading="lazy"
          draggable={false}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Play className="h-5 w-5 text-white drop-shadow-lg" fill="white" />
        </div>
      </div>
    )
  }
  if (!item.url) {
    return (
      <div className="w-full h-20 flex items-center justify-center bg-white/5">
        <Loader2 className="h-4 w-4 animate-spin text-white/40" />
      </div>
    )
  }
  return (
    <img src={item.url} alt={item.filename} className="w-full h-20 object-cover" loading="lazy" draggable={false} />
  )
}

export function MediaGallery({ isOpen, onClose, items, initialIndex, workspaceId, onItemChange }: MediaGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(true)
  const [showArrows, setShowArrows] = useState(false)
  // containerWidth drives both slide sizing and strip transform calculations on mobile
  const [containerWidth, setContainerWidth] = useState(0)

  // Mobile strip refs — all DOM manipulation goes through these to avoid re-render jank
  const containerRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const dismissWrapperRef = useRef<HTMLDivElement>(null)

  // Touch gesture state (all refs — no setState during active gesture)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  // Strip translateX at the moment the finger touches down (handles mid-animation starts)
  const touchStartStripX = useRef(0)
  const touchDeltaX = useRef(0)
  const touchDeltaY = useRef(0)
  const isSwiping = useRef(false)
  const swipeAxis = useRef<"x" | "y" | null>(null)
  const didSwipe = useRef(false)
  const lastTouchX = useRef(0)
  const lastTouchTime = useRef(0)
  const velocityX = useRef(0) // px/ms — used for flick-to-next even on short drags

  // Ref mirror of currentIndex so ResizeObserver can read it without stale closures
  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex

  const thumbnailRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Only sync currentIndex when the gallery opens — not on every initialIndex
  // change, which can shift due to late-loading images growing galleryImages.
  const prevOpen = useRef(false)
  const justOpened = useRef(false)
  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      setCurrentIndex(initialIndex)
      justOpened.current = true
    }
    prevOpen.current = isOpen
  }, [isOpen, initialIndex])

  // Re-anchor currentIndex when the items array shifts underneath it.
  const viewedIdRef = useRef<string | null>(null)
  viewedIdRef.current = items[currentIndex]?.attachmentId ?? null
  useEffect(() => {
    if (justOpened.current) {
      justOpened.current = false
      return
    }
    if (!isOpen || !viewedIdRef.current) return
    setCurrentIndex((prev) => {
      const corrected = items.findIndex((i) => i.attachmentId === viewedIdRef.current)
      return corrected !== -1 && corrected !== prev ? corrected : prev
    })
  }, [items, isOpen])

  // Scroll active thumbnail into view when index changes
  useEffect(() => {
    const el = thumbnailRefs.current.get(currentIndex)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [currentIndex])

  // Measure container width synchronously before first paint so slides size correctly
  useLayoutEffect(() => {
    if (!isOpen || !isMobile || !containerRef.current) return
    setContainerWidth(containerRef.current.offsetWidth)
  }, [isOpen, isMobile])

  // Re-anchor the strip on resize (e.g. screen rotation)
  useEffect(() => {
    if (!isMobile || !containerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w <= 0) return
      setContainerWidth(w)
      if (stripRef.current) {
        stripRef.current.style.transition = "none"
        stripRef.current.style.transform = `translateX(${-currentIndexRef.current * w}px)`
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [isMobile])

  // Position the strip at the current index whenever the gallery opens or the
  // container dimensions first become known. currentIndex is intentionally
  // excluded so that in-progress swipe animations aren't interrupted by state updates.
  useLayoutEffect(() => {
    if (!isOpen || !isMobile || containerWidth === 0 || !stripRef.current) return
    stripRef.current.style.transition = "none"
    stripRef.current.style.transform = `translateX(${-currentIndex * containerWidth}px)`
    // currentIndex intentionally excluded — position only on open/resize, not on every nav
  }, [isOpen, isMobile, containerWidth])

  const current = items[currentIndex] ?? null
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < items.length - 1
  const isMultiple = items.length > 1

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= items.length) return
      // On mobile, animate the strip directly before updating state so the
      // user sees a smooth slide rather than a hard cut.
      if (isMobile && stripRef.current && containerWidth > 0) {
        stripRef.current.style.transition = "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
        stripRef.current.style.transform = `translateX(${-index * containerWidth}px)`
      }
      setCurrentIndex(index)
      const next = items[index]
      if (next) onItemChange?.(next.attachmentId)
    },
    [items, onItemChange, isMobile, containerWidth]
  )

  const goPrev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex])
  const goNext = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex])

  const handleDownload = useCallback(() => {
    if (!current) return
    downloadImage(workspaceId, current.attachmentId, current.filename)
  }, [workspaceId, current])

  const handleDownloadRaw = useCallback(async () => {
    if (!current || current.type !== "video") return
    try {
      const url = await attachmentsApi.getDownloadUrl(workspaceId, current.attachmentId, {
        download: true,
        variant: "raw",
      })
      triggerDownload(url, current.filename)
    } catch {
      // Download failed silently
    }
  }, [workspaceId, current])

  const handleDownloadProcessed = useCallback(async () => {
    if (!current || current.type !== "video") return
    try {
      const url = await attachmentsApi.getDownloadUrl(workspaceId, current.attachmentId, {
        download: true,
        variant: "processed",
      })
      triggerDownload(url, current.filename.replace(/\.[^.]+$/, ".mp4"))
    } catch {
      // Download failed silently
    }
  }, [workspaceId, current])

  const handleCopy = useCallback(() => {
    if (current?.type === "image" && current.url) copyImage(current.url)
  }, [current])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault()
        goTo(currentIndex - 1)
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault()
        goTo(currentIndex + 1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, currentIndex, goTo])

  // ─── Mobile touch handlers ──────────────────────────────────────────────────
  // All handlers manipulate the DOM directly (no setState) so the gesture stays
  // at 60fps without React rendering in the hot path.

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
    // Read where the strip actually is right now (could be mid-animation)
    // so we can continue from that exact position rather than jumping.
    if (stripRef.current) {
      const matrix = new DOMMatrix(getComputedStyle(stripRef.current).transform)
      touchStartStripX.current = matrix.m41
      stripRef.current.style.transition = "none"
    }
    if (dismissWrapperRef.current) {
      dismissWrapperRef.current.style.transition = "none"
    }
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    lastTouchX.current = e.touches[0].clientX
    lastTouchTime.current = Date.now()
    velocityX.current = 0
    touchDeltaX.current = 0
    touchDeltaY.current = 0
    isSwiping.current = false
    swipeAxis.current = null
  }, [])

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation()
      const dx = e.touches[0].clientX - touchStartX.current
      const dy = e.touches[0].clientY - touchStartY.current
      touchDeltaX.current = dx
      touchDeltaY.current = dy

      // Rolling velocity — last frame's delta / elapsed ms
      const now = Date.now()
      const dt = now - lastTouchTime.current
      if (dt > 0) velocityX.current = (e.touches[0].clientX - lastTouchX.current) / dt
      lastTouchX.current = e.touches[0].clientX
      lastTouchTime.current = now

      if (!isSwiping.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        isSwiping.current = true
        swipeAxis.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
      }
      if (!isSwiping.current) return

      if (swipeAxis.current === "x") {
        if (!stripRef.current) return
        const atEdge = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext)
        const effectiveDx = atEdge ? dx * 0.3 : dx
        // Move the entire strip — both images slide together seamlessly
        stripRef.current.style.transform = `translateX(${touchStartStripX.current + effectiveDx}px)`
      } else {
        if (!dismissWrapperRef.current) return
        // Vertical: drag down to dismiss; resist upward drags
        const effectiveDy = dy > 0 ? dy : dy * 0.1
        const opacity = Math.max(0.2, 1 - effectiveDy / 300)
        dismissWrapperRef.current.style.transform = `translateY(${effectiveDy}px)`
        dismissWrapperRef.current.style.opacity = String(opacity)
      }
    },
    [hasPrev, hasNext]
  )

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation()
      const dx = touchDeltaX.current
      const dy = touchDeltaY.current
      const vx = velocityX.current

      if (isSwiping.current) {
        if (swipeAxis.current === "x") {
          const w = containerRef.current?.offsetWidth ?? window.innerWidth
          // Either traveled far enough OR flicked fast enough
          const distThreshold = w * 0.25
          const velThreshold = 0.3 // px/ms

          const goingNext = (dx < -distThreshold || vx < -velThreshold) && hasNext
          const goingPrev = (dx > distThreshold || vx > velThreshold) && hasPrev
          let targetIndex = currentIndex
          if (goingNext) targetIndex = currentIndex + 1
          else if (goingPrev) targetIndex = currentIndex - 1

          if (stripRef.current) {
            stripRef.current.style.transition = "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
            stripRef.current.style.transform = `translateX(${-targetIndex * w}px)`
          }

          if (targetIndex !== currentIndex) {
            didSwipe.current = true
            setCurrentIndex(targetIndex)
            const next = items[targetIndex]
            if (next) onItemChange?.(next.attachmentId)
          } else {
            didSwipe.current = false
          }
        } else if (swipeAxis.current === "y") {
          if (dy > 80) {
            // Commit dismiss — slide off screen
            if (dismissWrapperRef.current) {
              dismissWrapperRef.current.style.transition = "transform 0.3s ease-out, opacity 0.3s ease-out"
              dismissWrapperRef.current.style.transform = `translateY(${window.innerHeight}px)`
              dismissWrapperRef.current.style.opacity = "0"
            }
            didSwipe.current = true
            setTimeout(() => onClose(), 300)
          } else {
            // Below threshold — spring back
            if (dismissWrapperRef.current) {
              dismissWrapperRef.current.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out"
              dismissWrapperRef.current.style.transform = ""
              dismissWrapperRef.current.style.opacity = "1"
            }
          }
        }
      }

      isSwiping.current = false
      swipeAxis.current = null
    },
    [currentIndex, hasNext, hasPrev, items, onItemChange, onClose]
  )

  // Mobile: tap left/right zones to navigate (suppressed after a committed swipe)
  const handleMobileTap = useCallback(
    (e: React.MouseEvent) => {
      if (!isMobile || !isMultiple) return
      if (didSwipe.current) {
        didSwipe.current = false
        return
      }
      const rect = e.currentTarget.getBoundingClientRect()
      const zone = (e.clientX - rect.left) / rect.width
      if (zone < 0.3 && hasPrev) goPrev()
      else if (zone > 0.7 && hasNext) goNext()
    },
    [isMobile, isMultiple, hasPrev, hasNext, goPrev, goNext]
  )

  // ─── Action bar (shared between mobile/desktop) ─────────────────────────────
  const actionBar = (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
      {isMultiple && (
        <span className="text-xs text-white/70 mr-1 tabular-nums">
          {currentIndex + 1} / {items.length}
        </span>
      )}
      {current?.type === "video" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-white hover:bg-white/20 rounded-full">
              <Download className="h-5 w-5" />
              <span className="sr-only">Download video</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={handleDownloadProcessed}>Download processed</DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadRaw}>Download original</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
            onClick={handleDownload}
          >
            <Download className="h-5 w-5" />
            <span className="sr-only">Download image</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
            onClick={handleCopy}
          >
            <Copy className="h-5 w-5" />
            <span className="sr-only">Copy image</span>
          </Button>
        </>
      )}
      {!isMobile && isMultiple && (
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
          <span className="sr-only">{panelOpen ? "Hide" : "Show"} preview panel</span>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
        <span className="sr-only">Close</span>
      </Button>
    </div>
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {!current ? null : (
        <DialogContent
          className={cn(
            "p-0 max-sm:p-0 overflow-hidden bg-black/95 border-none",
            "max-sm:inset-auto max-sm:left-1/2 max-sm:top-1/2 max-sm:-translate-x-1/2 max-sm:-translate-y-1/2",
            "max-sm:max-w-[95vw] max-sm:h-[90vh] max-sm:rounded-lg",
            isMobile ? "max-w-[95vw] h-[90vh]" : "max-w-[90vw] h-[90vh]"
          )}
          hideCloseButton
        >
          <DialogTitle className="sr-only">{current.filename}</DialogTitle>
          <DialogDescription className="sr-only">
            {current.type === "image" ? "Image" : "Video"} {currentIndex + 1} of {items.length}
          </DialogDescription>

          <div className="relative flex h-full overflow-hidden">
            {isMobile ? (
              // ── Mobile: seamless horizontal strip carousel ────────────────
              // dismissWrapperRef handles the vertical "drag down to close" gesture.
              // containerRef clips the strip; stripRef holds all slides side-by-side
              // and moves as one unit so the entering image slides in simultaneously
              // with the exiting one — matching velocity and direction.
              <div ref={dismissWrapperRef} className="relative flex-1 min-w-0 min-h-0">
                {actionBar}

                <div
                  ref={containerRef}
                  className="absolute inset-0 overflow-hidden"
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onClick={handleMobileTap}
                >
                  {/* Strip: all slides laid out horizontally; transform moves them as one */}
                  <div ref={stripRef} className="flex h-full" style={{ willChange: "transform" }}>
                    {items.map((item, i) => (
                      <div
                        key={item.attachmentId}
                        className="shrink-0 flex items-center justify-center p-8"
                        style={{ width: containerWidth || "100%", height: "100%" }}
                      >
                        <GalleryMediaContent current={item} isActive={Math.abs(i - currentIndex) <= 1} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Filename bar sits above the strip so it doesn't scroll with it */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pointer-events-none z-10">
                  <span className="text-sm text-white">{current.filename}</span>
                </div>
              </div>
            ) : (
              // ── Desktop: single-image view with hover arrows ──────────────
              <div
                className="relative flex-1 min-w-0 min-h-0 flex items-center justify-center"
                onMouseEnter={() => setShowArrows(true)}
                onMouseLeave={() => setShowArrows(false)}
              >
                {actionBar}

                <div className="absolute inset-0 flex items-center justify-center p-10">
                  <GalleryMediaContent current={current} />
                </div>

                {isMultiple && (
                  <>
                    <button
                      type="button"
                      className={cn(
                        "absolute left-2 top-1/2 -translate-y-1/2 z-10",
                        "h-10 w-10 rounded-full bg-black/50 flex items-center justify-center",
                        "text-white hover:bg-black/70 transition-opacity duration-200",
                        !hasPrev && "invisible",
                        showArrows ? "opacity-100" : "opacity-0"
                      )}
                      onClick={goPrev}
                      aria-label="Previous"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 z-10",
                        "h-10 w-10 rounded-full bg-black/50 flex items-center justify-center",
                        "text-white hover:bg-black/70 transition-opacity duration-200",
                        !hasNext && "invisible",
                        showArrows ? "opacity-100" : "opacity-0"
                      )}
                      onClick={goNext}
                      aria-label="Next"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                  <span className="text-sm text-white">{current.filename}</span>
                </div>
              </div>
            )}

            {/* Desktop: thumbnail preview panel */}
            {!isMobile && isMultiple && panelOpen && (
              <div className="w-[140px] shrink-0 border-l border-white/10 bg-black/80 flex flex-col">
                <ScrollArea className="flex-1">
                  <div className="flex flex-col gap-1.5 p-2">
                    {items.map((item, i) => (
                      <button
                        key={item.attachmentId}
                        ref={(el) => {
                          if (el) thumbnailRefs.current.set(i, el)
                          else thumbnailRefs.current.delete(i)
                        }}
                        type="button"
                        className={cn(
                          "relative w-full rounded overflow-hidden border-2 transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          i === currentIndex
                            ? "border-white opacity-100"
                            : "border-transparent opacity-50 hover:opacity-80"
                        )}
                        onClick={() => goTo(i)}
                        aria-label={`View ${item.filename}`}
                        aria-current={i === currentIndex ? "true" : undefined}
                      >
                        <GalleryThumbnailContent item={item} />
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
