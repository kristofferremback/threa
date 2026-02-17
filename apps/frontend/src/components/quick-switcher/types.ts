import type { NavigateFunction } from "react-router-dom"
import type { Stream, StreamMember, WorkspaceMember } from "@threa/types"

export interface QuickSwitcherItem {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  description?: string
  group?: string
  href?: string
  onSelect: () => void
  /** Optional action button (e.g., delete) */
  onAction?: () => void
  /** Icon for the action button */
  actionIcon?: React.ComponentType<{ className?: string }>
  /** Aria label for the action button */
  actionLabel?: string
}

export interface ModeContext {
  workspaceId: string
  query: string
  onQueryChange: (query: string) => void
  navigate: NavigateFunction
  closeDialog: () => void
  streams: Stream[]
  streamMemberships: StreamMember[]
  members?: WorkspaceMember[]
  currentMemberId?: string | null
  dmPeers?: Array<{ memberId: string; streamId: string }>
}

export interface ModeResult {
  items: QuickSwitcherItem[]
  isLoading?: boolean
  emptyMessage?: string
  header?: React.ReactNode
  /** True when filter select picker is open (for Escape handling) */
  isFilterSelectActive?: boolean
  /** Close the filter select picker */
  closeFilterSelect?: () => void
}
