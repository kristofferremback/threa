import { cn } from "@/lib/utils"

type IconSize = "xs" | "sm" | "md" | "lg"

const SIZE_MAP: Record<IconSize, number> = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 32,
}

/** Stroke width increases at smaller sizes for legibility */
const STROKE_WIDTH_MAP: Record<IconSize, number> = {
  xs: 6,
  sm: 5,
  md: 4,
  lg: 3,
}

/** Ripple stroke width - thinner than main icon */
const RIPPLE_STROKE_MAP: Record<IconSize, number> = {
  xs: 4,
  sm: 3,
  md: 2.5,
  lg: 2,
}

interface AriadneIconProps {
  size?: IconSize | number
  /** Enable breathing animation (subtle pulse with glow) */
  animated?: boolean
  /** Enable loading state with whisper ripple - requires animated=true */
  loading?: boolean
  className?: string
}

/** The heart/thread path - the core Ariadne symbol */
const HEART_PATH =
  "M 50 18 C 28 18, 20 35, 28 48 C 36 61, 50 55, 50 50 C 50 45, 64 39, 72 48 C 80 57, 72 70, 50 82 C 28 70, 20 57, 28 48"

/**
 * Ariadne persona icon - a stylized heart/thread design.
 *
 * Uses currentColor to inherit theme colors (gold from --primary).
 * Stroke width adjusts based on size for legibility at small sizes.
 *
 * Animation states:
 * - Static (default): No animation
 * - Animated: Breathing animation with subtle glow pulse
 * - Loading: Breathing + whisper ripple expanding outward
 */
export function AriadneIcon({ size = "md", animated = false, loading = false, className }: AriadneIconProps) {
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size]

  // Calculate stroke widths based on size
  const strokeWidth =
    typeof size === "number" ? (size <= 16 ? 6 : size <= 20 ? 5 : size <= 28 ? 4 : 3) : STROKE_WIDTH_MAP[size]

  const rippleStrokeWidth =
    typeof size === "number" ? (size <= 16 ? 4 : size <= 20 ? 3 : size <= 28 ? 2.5 : 2) : RIPPLE_STROKE_MAP[size]

  // Static icon - just the SVG, no wrapper needed
  if (!animated && !loading) {
    return (
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={pixelSize}
        height={pixelSize}
        className={cn("text-current", className)}
        aria-label="Ariadne"
        role="img"
      >
        <path d={HEART_PATH} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      </svg>
    )
  }

  // Animated icon - needs wrapper for ripple overlay
  return (
    <span
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: pixelSize, height: pixelSize }}
      role="img"
      aria-label={loading ? "Ariadne is thinking" : "Ariadne"}
    >
      {/* Whisper ripple - only visible when loading */}
      {loading && (
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          width={pixelSize}
          height={pixelSize}
          className="absolute inset-0 animate-ariadne-ripple"
        >
          <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth={rippleStrokeWidth} fill="none" />
        </svg>
      )}

      {/* Heart icon */}
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={pixelSize}
        height={pixelSize}
        className="animate-ariadne-breathe"
      >
        <path d={HEART_PATH} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      </svg>
    </span>
  )
}
