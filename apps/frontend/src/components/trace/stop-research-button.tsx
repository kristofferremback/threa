import { StopCircle } from "lucide-react"

// Workspace-research step hue — matches STEP_DISPLAY_CONFIG.workspace_search (hue 270).
// Used on hover so the Stop button visually ties to the purple step it stops.
// Kept as inline styles rather than Tailwind arbitrary variants because Tailwind JIT
// can't pick up template-interpolated class names, and this colour is only used here.
const HOVER_BORDER = "hsl(270 60% 50% / 0.45)"
const HOVER_BG = "hsl(270 60% 50% / 0.08)"
const HOVER_FG = "hsl(270 60% 50%)"

interface StopResearchButtonProps {
  onClick: () => void
  /**
   * Set to true when the button is rendered inside a clickable wrapper (e.g. the
   * timeline card's outer `<Link>`). Prevents the click from bubbling to the
   * wrapper and accidentally navigating.
   */
  stopPropagation?: boolean
}

/**
 * Compact "Stop research" button. Shared between the timeline card and the
 * in-flight trace step card so the two surfaces stay visually identical.
 *
 * Always visible (not a hover-reveal) so the interrupt action is discoverable
 * without guessing, and tinted toward workspace_search purple on hover so its
 * destination is obvious.
 */
export function StopResearchButton({ onClick, stopPropagation }: StopResearchButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopPropagation) {
          e.preventDefault()
          e.stopPropagation()
        }
        onClick()
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = HOVER_BORDER
        e.currentTarget.style.backgroundColor = HOVER_BG
        e.currentTarget.style.color = HOVER_FG
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ""
        e.currentTarget.style.backgroundColor = ""
        e.currentTarget.style.color = ""
      }}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all duration-150"
      title="Stop the in-flight workspace research and continue with whatever was found so far"
    >
      <StopCircle className="h-3.5 w-3.5" />
      Stop research
    </button>
  )
}
