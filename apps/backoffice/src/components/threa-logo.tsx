import { cn } from "@/lib/utils"

/**
 * Threa wordmark — vesica piscis (the needle's eye) with an S-curve thread
 * passing through it. Ported from apps/frontend/src/components/threa-logo.tsx;
 * trimmed to a single size knob since the backoffice doesn't need the full
 * size matrix.
 */
interface ThreaLogoProps {
  size?: number
  className?: string
}

function strokeWeights(size: number): { vesica: number; thread: number } {
  // Stroke weight scales gently with size — chunkier at small sizes so the
  // mark stays legible at favicon dimensions.
  if (size <= 20) return { vesica: 4.5, thread: 5 }
  if (size <= 28) return { vesica: 3.75, thread: 4.25 }
  return { vesica: 3, thread: 3.5 }
}

export function ThreaLogo({ size = 28, className }: ThreaLogoProps) {
  const { vesica: vesicaStroke, thread: threadStroke } = strokeWeights(size)

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={cn("stroke-[hsl(var(--primary))]", className)}
      aria-label="Threa logo"
      role="img"
    >
      <path
        d="M 50 24 C 64 30, 72 42, 72 50 C 72 58, 64 70, 50 76 C 36 70, 28 58, 28 50 C 28 42, 36 30, 50 24 Z"
        strokeWidth={vesicaStroke}
        fill="none"
      />
      <path
        d="M 50 14 C 47 26, 46 38, 50 50 C 54 62, 53 74, 50 86"
        strokeWidth={threadStroke}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
