import { cn } from "@/lib/utils"

type LogoSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl"

const SIZE_MAP: Record<LogoSize, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
  "2xl": 128,
}

const STROKE_WEIGHTS: Record<LogoSize, { vesica: number; thread: number }> = {
  xs: { vesica: 5, thread: 6 },
  sm: { vesica: 4, thread: 5 },
  md: { vesica: 3.5, thread: 4 },
  lg: { vesica: 3, thread: 3.5 },
  xl: { vesica: 2.5, thread: 3 },
  "2xl": { vesica: 2.5, thread: 3 },
}

interface ThreaLogoProps {
  size?: LogoSize | number
  className?: string
  color?: "auto" | "dark" | "light"
}

export function ThreaLogo({ size = "md", className, color = "auto" }: ThreaLogoProps) {
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size]
  const sizeKey = typeof size === "number" ? getSizeKeyForPixels(size) : size
  const weights = STROKE_WEIGHTS[sizeKey]

  const colorClass =
    color === "auto" ? "stroke-[hsl(var(--primary))]" : color === "dark" ? "stroke-[#C8A055]" : "stroke-[#8B7332]"

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={pixelSize}
      height={pixelSize}
      className={cn(colorClass, className)}
      aria-label="Threa logo"
      role="img"
    >
      {/* Vesica piscis - the needle's eye */}
      <path
        d="M 50 24 C 64 30, 72 42, 72 50 C 72 58, 64 70, 50 76 C 36 70, 28 58, 28 50 C 28 42, 36 30, 50 24 Z"
        strokeWidth={weights.vesica}
        fill="none"
      />
      {/* Thread - the S-curve passing through */}
      <path
        d="M 50 14 C 47 26, 46 38, 50 50 C 54 62, 53 74, 50 86"
        strokeWidth={weights.thread}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

function getSizeKeyForPixels(pixels: number): LogoSize {
  if (pixels <= 16) return "xs"
  if (pixels <= 24) return "sm"
  if (pixels <= 32) return "md"
  if (pixels <= 48) return "lg"
  if (pixels <= 64) return "xl"
  return "2xl"
}

interface ThreaLogoWithTextProps {
  size?: "sm" | "md" | "lg"
  className?: string
  color?: "auto" | "dark" | "light"
}

const TEXT_SIZE_MAP = {
  sm: { logo: 24, text: "text-lg" },
  md: { logo: 32, text: "text-xl" },
  lg: { logo: 48, text: "text-2xl" },
}

export function ThreaLogoWithText({ size = "md", className, color = "auto" }: ThreaLogoWithTextProps) {
  const config = TEXT_SIZE_MAP[size]

  const textColorClass =
    color === "auto" ? "text-[hsl(var(--primary))]" : color === "dark" ? "text-[#C8A055]" : "text-[#8B7332]"

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ThreaLogo size={config.logo} color={color} />
      <span className={cn("font-light tracking-[0.15em] uppercase", config.text, textColorClass)}>Threa</span>
    </div>
  )
}
