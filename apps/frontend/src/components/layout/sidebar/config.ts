import { FileEdit, Hash, User, type LucideIcon } from "lucide-react"
import type { SectionKey, SortType, UrgencyLevel } from "./types"

export const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  mentions: "hsl(0 90% 55%)", // Vibrant red
  activity: "hsl(210 100% 55%)", // Bright blue
  quiet: "transparent", // Hidden when no activity
  ai: "hsl(45 100% 50%)", // Bright gold/amber
}

interface BadgeConfig {
  icon: LucideIcon
  color: string
}

export const BADGE_CONFIG: Record<string, BadgeConfig> = {
  channel: { icon: Hash, color: "text-[hsl(200_60%_50%)]" },
  scratchpad: { icon: FileEdit, color: "text-primary" },
  dm: { icon: User, color: "text-muted-foreground" },
}

interface SmartSectionConfig {
  label: string
  icon: string
  compact: boolean
  showPreviewOnHover: boolean
  sortType: SortType
}

/** Smart view section configuration - single source of truth for section behavior */
export const SMART_SECTIONS: Record<SectionKey, SmartSectionConfig> = {
  important: {
    label: "Important",
    icon: "⚡",
    compact: false, // Shows full preview always
    showPreviewOnHover: false,
    sortType: "importance",
  },
  recent: {
    label: "Recent",
    icon: "🕐",
    compact: true,
    showPreviewOnHover: true,
    sortType: "activity",
  },
  pinned: {
    label: "Pinned",
    icon: "📌",
    compact: true,
    showPreviewOnHover: true,
    sortType: "activity",
  },
  other: {
    label: "Everything Else",
    icon: "📂",
    compact: true,
    showPreviewOnHover: true,
    sortType: "activity",
  },
}

/** All view section configuration */
export const ALL_SECTIONS = {
  scratchpads: { sortType: "activity" as SortType },
  channels: { sortType: "alphabetic_active_first" as SortType },
  dms: { sortType: "alphabetic_active_first" as SortType },
} as const
