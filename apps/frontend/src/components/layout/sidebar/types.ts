import type { StreamWithPreview } from "@threa/types"

export type UrgencyLevel = "mentions" | "activity" | "quiet" | "ai"

/** Sorting strategies for sidebar sections */
export type SortType = "activity" | "importance" | "alphabetic_active_first"

export const SMART_SECTION_KEYS = ["important", "recent", "pinned", "other"] as const

export type SectionKey = (typeof SMART_SECTION_KEYS)[number]

export interface StreamItemData extends StreamWithPreview {
  urgency: UrgencyLevel
  section: SectionKey
  dmPeerMemberId?: string
}
