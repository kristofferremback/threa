import { Button } from "@/components/ui/button"
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { ZOOM_MIN, ZOOM_MAX } from "@/hooks/use-zoom-pan"
import { cn } from "@/lib/utils"

interface ZoomControlsProps {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  className?: string
}

export function ZoomControls({ scale, onZoomIn, onZoomOut, onReset, className }: ZoomControlsProps) {
  const canZoomIn = scale < ZOOM_MAX - 1e-3
  const canZoomOut = scale > ZOOM_MIN + 1e-3
  const percent = Math.round(scale * 100)

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-black/50 backdrop-blur-sm px-1 py-1 text-white",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full text-white hover:bg-white/20 disabled:opacity-40"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <span className="min-w-[44px] text-center text-xs tabular-nums text-white/80 select-none">{percent}%</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full text-white hover:bg-white/20 disabled:opacity-40"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8 rounded-full text-white hover:bg-white/20 disabled:opacity-40 transition-opacity",
          canZoomOut ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onReset}
        aria-label="Reset zoom"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
