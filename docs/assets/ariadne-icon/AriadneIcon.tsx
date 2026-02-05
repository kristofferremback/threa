import { type CSSProperties, type FC } from "react"

/**
 * Ariadne Icon Component
 *
 * The icon for Threa's AI assistant, featuring a stylized heart/thread design.
 * Supports static, breathing (animated), and loading states.
 *
 * @example
 * // Static icon
 * <AriadneIcon size="md" />
 *
 * // Animated (breathing)
 * <AriadneIcon size="md" animated />
 *
 * // Loading state with whisper ripple
 * <AriadneIcon size="md" animated loading />
 *
 * // Light mode with avatar frame
 * <AriadneIcon size="md" variant="light" avatar />
 */

export type AriadneIconSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl"
export type AriadneIconVariant = "dark" | "light"

export interface AriadneIconProps {
  /** Size preset or custom pixel value */
  size?: AriadneIconSize | number
  /** Color variant for different backgrounds */
  variant?: AriadneIconVariant
  /** Enable breathing animation */
  animated?: boolean
  /** Enable loading state (whisper ripple) - requires animated=true */
  loading?: boolean
  /** Show circular avatar frame background */
  avatar?: boolean
  /** Additional CSS classes */
  className?: string
  /** Inline styles */
  style?: CSSProperties
}

const SIZE_MAP: Record<AriadneIconSize, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
  "2xl": 80,
}

const STROKE_WIDTH_MAP: Record<AriadneIconSize, number> = {
  xs: 6,
  sm: 5,
  md: 4,
  lg: 3,
  xl: 2.5,
  "2xl": 2.5,
}

const RIPPLE_STROKE_MAP: Record<AriadneIconSize, number> = {
  xs: 4,
  sm: 3,
  md: 2.5,
  lg: 2,
  xl: 1.5,
  "2xl": 1,
}

const COLORS = {
  dark: {
    stroke: "#C8A055",
    glowSoft: "rgba(200, 160, 85, 0.2)",
    glowStrong: "rgba(200, 160, 85, 0.5)",
    rippleOpacity: 0.15,
    avatarBg: "#111",
    avatarBorder: "#222",
  },
  light: {
    stroke: "#9A7B3D",
    glowSoft: "rgba(154, 123, 61, 0.15)",
    glowStrong: "rgba(154, 123, 61, 0.35)",
    rippleOpacity: 0.12,
    avatarBg: "#f5f5f5",
    avatarBorder: "#e0e0e0",
  },
}

// The heart/thread path - this is the core Ariadne symbol
const HEART_PATH =
  "M 50 18 C 28 18, 20 35, 28 48 C 36 61, 50 55, 50 50 C 50 45, 64 39, 72 48 C 80 57, 72 70, 50 82 C 28 70, 20 57, 28 48"

export const AriadneIcon: FC<AriadneIconProps> = ({
  size = "md",
  variant = "dark",
  animated = false,
  loading = false,
  avatar = false,
  className = "",
  style,
}) => {
  const sizeKey = typeof size === "string" ? size : "md"
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[sizeKey]
  const strokeWidth =
    typeof size === "number"
      ? size <= 20
        ? 6
        : size <= 30
          ? 5
          : size <= 40
            ? 4
            : size <= 56
              ? 3
              : 2.5
      : STROKE_WIDTH_MAP[sizeKey]
  const rippleStrokeWidth =
    typeof size === "number"
      ? size <= 20
        ? 4
        : size <= 30
          ? 3
          : size <= 40
            ? 2.5
            : size <= 56
              ? 2
              : 1.5
      : RIPPLE_STROKE_MAP[sizeKey]

  const colors = COLORS[variant]

  // Animation keyframes as inline styles (for portability)
  const breatheAnimation = animated ? "ariadne-breathe 2s ease-in-out infinite" : undefined

  const rippleAnimation = loading ? "ariadne-ripple-whisper 2s ease-in-out infinite" : undefined

  const containerStyle: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: pixelSize,
    height: pixelSize,
    ...(avatar && {
      borderRadius: "50%",
      background: colors.avatarBg,
      border: `1.5px solid ${colors.avatarBorder}`,
    }),
    ...style,
  }

  const heartStyle: CSSProperties = {
    display: "block",
    overflow: "visible",
    animation: breatheAnimation,
    transformOrigin: "center",
  }

  const rippleStyle: CSSProperties = {
    position: "absolute",
    display: loading ? "block" : "none",
    overflow: "visible",
    animation: rippleAnimation,
    transformOrigin: "center",
  }

  // Icon size is 70% of container when in avatar mode
  const iconSize = avatar ? pixelSize * 0.7 : pixelSize

  return (
    <>
      {/* Inject keyframes if animated */}
      {animated && (
        <style>{`
          @keyframes ariadne-breathe {
            0%, 100% { 
              transform: scale(1);
              filter: drop-shadow(0 0 2px ${colors.glowSoft});
            }
            50% { 
              transform: scale(1.04);
              filter: drop-shadow(0 0 6px ${colors.glowStrong});
            }
          }
          
          @keyframes ariadne-ripple-whisper {
            0%, 100% { 
              transform: scale(1);
              opacity: ${colors.rippleOpacity};
            }
            50% { 
              transform: scale(1.08);
              opacity: 0;
            }
          }
          
          @media (prefers-reduced-motion: reduce) {
            @keyframes ariadne-breathe {
              0%, 100% { 
                transform: scale(1);
                filter: drop-shadow(0 0 4px ${colors.glowSoft});
              }
            }
            @keyframes ariadne-ripple-whisper {
              0%, 100% { 
                transform: scale(1);
                opacity: 0;
              }
            }
          }
        `}</style>
      )}

      <div
        className={`ariadne-icon ${className}`}
        style={containerStyle}
        role="img"
        aria-label={loading ? "Ariadne is thinking" : "Ariadne"}
      >
        {/* Ripple ring (only visible when loading) */}
        <svg viewBox="0 0 100 100" width={pixelSize} height={pixelSize} style={rippleStyle} aria-hidden="true">
          <circle cx="50" cy="50" r="42" stroke={colors.stroke} strokeWidth={rippleStrokeWidth} fill="none" />
        </svg>

        {/* Heart/thread icon */}
        <svg viewBox="0 0 100 100" width={iconSize} height={iconSize} style={heartStyle} fill="none">
          <path d={HEART_PATH} stroke={colors.stroke} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </>
  )
}

export default AriadneIcon
