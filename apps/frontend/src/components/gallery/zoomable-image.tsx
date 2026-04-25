import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { useZoomPan } from "@/hooks/use-zoom-pan"

export interface ZoomableImageHandle {
  reset: () => void
  zoomIn: () => void
  zoomOut: () => void
}

interface ZoomableImageProps {
  src: string
  alt: string
  onZoomChange?: (zoomed: boolean) => void
  onScaleChange?: (scale: number) => void
}

export const ZoomableImage = forwardRef<ZoomableImageHandle, ZoomableImageProps>(function ZoomableImage(
  { src, alt, onZoomChange, onScaleChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const { isZoomed, scale, zoomIn, zoomOut, reset } = useZoomPan({
    containerRef,
    contentRef: imgRef,
    onZoomChange,
  })

  useEffect(() => {
    onScaleChange?.(scale)
  }, [scale, onScaleChange])

  useImperativeHandle(
    ref,
    () => ({
      reset: () => reset({ transition: true }),
      zoomIn,
      zoomOut,
    }),
    [reset, zoomIn, zoomOut]
  )

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{
        // Disable browser pinch-zoom / scroll gestures inside the viewport so our
        // custom handlers own the input. Double-tap-to-zoom is handled manually.
        touchAction: "none",
        cursor: isZoomed ? "grab" : "default",
        userSelect: "none",
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain select-none"
        draggable={false}
        style={{ willChange: "transform" }}
      />
    </div>
  )
})
