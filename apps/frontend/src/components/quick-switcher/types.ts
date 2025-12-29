import type { NavigateFunction } from "react-router-dom"
import type { Stream } from "@threa/types"

export interface QuickSwitcherItem {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  description?: string
  group?: string
  onSelect: () => void
}

export interface ModeContext {
  workspaceId: string
  query: string
  navigate: NavigateFunction
  closeDialog: () => void
  streams: Stream[]
}

export interface ModeResult {
  items: QuickSwitcherItem[]
  isLoading?: boolean
  emptyMessage?: string
  header?: React.ReactNode
}
