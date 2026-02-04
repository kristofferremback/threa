import { cn } from "@/lib/utils"

interface TopbarLoadingIndicatorProps {
  /** Whether the indicator is visible */
  visible: boolean
  /** Additional class names */
  className?: string
}

/**
 * A subtle loading indicator that appears at the bottom border of the topbar.
 *
 * Renders as a thin line with a shimmer effect that moves back and forth.
 * Uses the golden thread primary color for visual consistency.
 *
 * The animation is a CSS-only shimmer that glides across the full width,
 * creating a sense of progress without indicating a specific percentage.
 */
export function TopbarLoadingIndicator({ visible, className }: TopbarLoadingIndicatorProps) {
  return (
    <div
      className={cn(
        "absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden",
        "transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
        className
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={undefined}
      aria-label="Loading"
      aria-hidden={!visible}
    >
      {/* Background track - subtle base */}
      <div className="absolute inset-0 bg-border/50" />

      {/* Animated shimmer - the golden thread */}
      <div
        className={cn(
          "absolute inset-y-0 w-1/3",
          "bg-gradient-to-r from-transparent via-primary to-transparent",
          visible && "animate-topbar-shimmer"
        )}
        style={{
          // Ensure the shimmer gradient has good opacity
          background: `linear-gradient(
            90deg,
            transparent 0%,
            hsl(var(--primary) / 0.7) 50%,
            transparent 100%
          )`,
        }}
      />
    </div>
  )
}
