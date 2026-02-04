import { cn } from "@/lib/utils"

type IconSize = "xs" | "sm" | "md" | "lg"

const SIZE_MAP: Record<IconSize, number> = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 32,
}

interface AriadneIconProps {
  size?: IconSize | number
  className?: string
}

/**
 * Ariadne persona icon - a distinctive mark for the AI companion.
 *
 * PLACEHOLDER: Replace the SVG paths below with the final Ariadne icon design.
 * The icon should work at small sizes (14-32px) and use currentColor for theming.
 */
export function AriadneIcon({ size = "md", className }: AriadneIconProps) {
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size]

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={pixelSize}
      height={pixelSize}
      className={cn("text-current", className)}
      aria-label="Ariadne"
      role="img"
    >
      {/*
        PLACEHOLDER ICON: Simple thread/spiral motif
        Replace with final Ariadne icon design.
        Use stroke="currentColor" for theme compatibility.
      */}
      <path
        d="M12 3C7.5 3 4 6.5 4 11c0 3 1.5 5.5 4 7l4 4 4-4c2.5-1.5 4-4 4-7 0-4.5-3.5-8-8-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M12 7c-2 0-3.5 1.5-3.5 3.5S10 14 12 14s3.5-1.5 3.5-3.5S14 7 12 7z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="12" cy="10.5" r="1" fill="currentColor" />
    </svg>
  )
}
