import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { X, Download, Copy, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react"
import { downloadImage, copyImage } from "@/lib/image-utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export interface GalleryImage {
  url: string
  filename: string
  attachmentId: string
}

interface ImageGalleryProps {
  isOpen: boolean
  onClose: () => void
  images: GalleryImage[]
  initialIndex: number
  workspaceId: string
}

export function ImageGallery({ isOpen, onClose, images, initialIndex, workspaceId }: ImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(true)
  const [showArrows, setShowArrows] = useState(false)

  // Mobile swipe state
  const touchStartX = useRef(0)
  const touchDeltaX = useRef(0)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const isSwiping = useRef(false)

  // Scroll active thumbnail into view
  const thumbnailRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Reset index when gallery opens with a new initial index
  useEffect(() => {
    if (isOpen) setCurrentIndex(initialIndex)
  }, [isOpen, initialIndex])

  // Scroll active thumbnail into view when index changes
  useEffect(() => {
    const el = thumbnailRefs.current.get(currentIndex)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [currentIndex])

  const current = images[currentIndex] ?? null
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < images.length - 1
  const isMultiple = images.length > 1

  const goTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < images.length) setCurrentIndex(index)
    },
    [images.length]
  )

  const goPrev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex])
  const goNext = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex])

  const handleDownload = useCallback(() => {
    if (current) downloadImage(workspaceId, current.attachmentId, current.filename)
  }, [workspaceId, current])

  const handleCopy = useCallback(() => {
    if (current) copyImage(current.url)
  }, [current])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        goTo(currentIndex - 1)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goTo(currentIndex + 1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, currentIndex, goTo])

  // Mobile touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    isSwiping.current = false
  }, [])

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.touches[0].clientX - touchStartX.current
      touchDeltaX.current = delta

      // Only start swiping after a minimum threshold to avoid conflict with scroll
      if (Math.abs(delta) > 10) {
        isSwiping.current = true
      }

      if (!isSwiping.current) return

      // Dampen at edges
      const atEdge = (delta > 0 && !hasPrev) || (delta < 0 && !hasNext)
      setSwipeOffset(atEdge ? delta * 0.3 : delta)
    },
    [hasPrev, hasNext]
  )

  const handleTouchEnd = useCallback(() => {
    const delta = touchDeltaX.current
    const threshold = 50

    if (isSwiping.current) {
      if (delta < -threshold && hasNext) {
        goNext()
      } else if (delta > threshold && hasPrev) {
        goPrev()
      }
    }

    setSwipeOffset(0)
    isSwiping.current = false
  }, [hasNext, hasPrev, goNext, goPrev])

  if (!current) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "p-0 max-sm:p-0 overflow-hidden bg-black/95 border-none",
          "max-sm:inset-auto max-sm:left-1/2 max-sm:top-1/2 max-sm:-translate-x-1/2 max-sm:-translate-y-1/2",
          "max-sm:max-w-[95vw] max-sm:max-h-[90vh] max-sm:rounded-lg",
          isMobile ? "max-w-[95vw] max-h-[90vh]" : "max-w-[90vw] max-h-[90vh]"
        )}
        hideCloseButton
      >
        <DialogTitle className="sr-only">{current.filename}</DialogTitle>
        <DialogDescription className="sr-only">
          Image {currentIndex + 1} of {images.length}
        </DialogDescription>

        <div className="relative flex h-full">
          {/* Main image area */}
          <div
            className="relative flex-1 flex items-center justify-center min-w-0"
            onMouseEnter={() => !isMobile && setShowArrows(true)}
            onMouseLeave={() => !isMobile && setShowArrows(false)}
            {...(isMobile
              ? {
                  onTouchStart: handleTouchStart,
                  onTouchMove: handleTouchMove,
                  onTouchEnd: handleTouchEnd,
                }
              : {})}
          >
            {/* Top action bar */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              {isMultiple && (
                <span className="text-xs text-white/70 mr-1 tabular-nums">
                  {currentIndex + 1} / {images.length}
                </span>
              )}
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
              {/* Desktop: toggle preview panel */}
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

            {/* Image with mobile swipe offset */}
            <div
              className="flex items-center justify-center w-full h-full"
              style={isMobile && swipeOffset !== 0 ? { transform: `translateX(${swipeOffset}px)` } : undefined}
            >
              <img
                src={current.url}
                alt={current.filename}
                className="max-w-full max-h-[85vh] object-contain select-none"
                draggable={false}
              />
            </div>

            {/* Desktop: hover arrows */}
            {!isMobile && isMultiple && (
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
                  aria-label="Previous image"
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
                  aria-label="Next image"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}

            {/* Filename bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <span className="text-sm text-white">{current.filename}</span>
            </div>
          </div>

          {/* Desktop: preview panel */}
          {!isMobile && isMultiple && panelOpen && (
            <div className="w-[140px] shrink-0 border-l border-white/10 bg-black/80 flex flex-col">
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-1.5 p-2">
                  {images.map((img, i) => (
                    <button
                      key={img.attachmentId}
                      ref={(el) => {
                        if (el) thumbnailRefs.current.set(i, el)
                        else thumbnailRefs.current.delete(i)
                      }}
                      type="button"
                      className={cn(
                        "relative rounded overflow-hidden border-2 transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        i === currentIndex
                          ? "border-white opacity-100"
                          : "border-transparent opacity-50 hover:opacity-80"
                      )}
                      onClick={() => goTo(i)}
                      aria-label={`View ${img.filename}`}
                      aria-current={i === currentIndex ? "true" : undefined}
                    >
                      <img
                        src={img.url}
                        alt={img.filename}
                        className="w-full h-20 object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
