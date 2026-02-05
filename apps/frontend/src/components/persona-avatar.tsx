import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { AriadneIcon } from "@/components/ariadne-icon"
import { cn } from "@/lib/utils"

/** System persona slug for Ariadne - uses SVG icon instead of emoji */
const ARIADNE_SLUG = "ariadne"

type AvatarSize = "sm" | "md" | "lg"

const SIZE_CONFIG: Record<AvatarSize, { avatar: string; icon: "xs" | "sm" | "md"; text: string }> = {
  sm: { avatar: "h-7 w-7", icon: "xs", text: "text-xs" },
  md: { avatar: "h-9 w-9 rounded-[10px]", icon: "sm", text: "text-sm" },
  lg: { avatar: "h-11 w-11 rounded-[12px]", icon: "md", text: "text-base" },
}

interface PersonaAvatarProps {
  /** Persona slug (e.g., "ariadne") - used to determine if SVG icon should be rendered */
  slug?: string
  /** Fallback display: emoji or initials */
  fallback: string
  /** Size variant */
  size?: AvatarSize
  /** Additional className for the Avatar wrapper */
  className?: string
}

/**
 * Avatar component for personas that handles special icons.
 *
 * - For Ariadne: renders the AriadneIcon SVG with gold border
 * - For other personas: renders emoji or initials with solid gold background
 *
 * Centralizes the logic for persona avatar rendering so it's consistent
 * across message timeline, mention list, and other UI.
 */
export function PersonaAvatar({ slug, fallback, size = "md", className }: PersonaAvatarProps) {
  const config = SIZE_CONFIG[size]
  const isAriadne = slug === ARIADNE_SLUG

  return (
    <Avatar className={cn(config.avatar, "shrink-0", className)}>
      <AvatarFallback className={cn("bg-primary text-primary-foreground", config.text)}>
        {isAriadne ? <AriadneIcon size={config.icon} /> : fallback}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * Check if a persona slug should use an SVG icon instead of emoji.
 * Useful when you need to know before rendering (e.g., for different layouts).
 */
export function personaHasSvgIcon(slug: string | undefined): boolean {
  return slug === ARIADNE_SLUG
}
