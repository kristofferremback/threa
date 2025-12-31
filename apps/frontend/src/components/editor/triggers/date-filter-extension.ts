/**
 * TipTap extension for `after:` and `before:` date filter triggers in search mode.
 * Shows date picker/suggestions when user types `after:` or `before:`.
 *
 * Inserts plain text like "after:2025-01-15 " or "before:2025-12-31 ".
 */
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

export const DateFilterPluginKey = new PluginKey("dateFilter")

export type DateFilterType = "after" | "before"

export interface DateFilterItem {
  id: string
  label: string
  value: string // ISO date string or relative value
  description: string
  filterType: DateFilterType
  isCustom?: boolean // True for "Pick a date..." option that opens calendar
}

/**
 * Generate quick date options for the date picker.
 */
export function getDateFilterOptions(filterType: DateFilterType): DateFilterItem[] {
  const today = new Date()
  const formatDate = (d: Date) => d.toISOString().split("T")[0]

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const lastWeek = new Date(today)
  lastWeek.setDate(lastWeek.getDate() - 7)

  const lastMonth = new Date(today)
  lastMonth.setMonth(lastMonth.getMonth() - 1)

  const last3Months = new Date(today)
  last3Months.setMonth(last3Months.getMonth() - 3)

  const lastYear = new Date(today)
  lastYear.setFullYear(lastYear.getFullYear() - 1)

  if (filterType === "after") {
    return [
      { id: "today", label: "Today", value: formatDate(today), description: formatDate(today), filterType },
      {
        id: "yesterday",
        label: "Yesterday",
        value: formatDate(yesterday),
        description: formatDate(yesterday),
        filterType,
      },
      {
        id: "last-week",
        label: "Last week",
        value: formatDate(lastWeek),
        description: formatDate(lastWeek),
        filterType,
      },
      {
        id: "last-month",
        label: "Last month",
        value: formatDate(lastMonth),
        description: formatDate(lastMonth),
        filterType,
      },
      {
        id: "last-3-months",
        label: "Last 3 months",
        value: formatDate(last3Months),
        description: formatDate(last3Months),
        filterType,
      },
      {
        id: "last-year",
        label: "Last year",
        value: formatDate(lastYear),
        description: formatDate(lastYear),
        filterType,
      },
      {
        id: "custom",
        label: "Pick a date...",
        value: "",
        description: "Open calendar",
        filterType,
        isCustom: true,
      },
    ]
  } else {
    // "before" - show future-oriented options
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)

    return [
      { id: "today", label: "Today", value: formatDate(today), description: formatDate(today), filterType },
      {
        id: "yesterday",
        label: "Yesterday",
        value: formatDate(yesterday),
        description: formatDate(yesterday),
        filterType,
      },
      {
        id: "last-week",
        label: "Last week",
        value: formatDate(lastWeek),
        description: formatDate(lastWeek),
        filterType,
      },
      {
        id: "last-month",
        label: "Last month",
        value: formatDate(lastMonth),
        description: formatDate(lastMonth),
        filterType,
      },
      {
        id: "custom",
        label: "Pick a date...",
        value: "",
        description: "Open calendar",
        filterType,
        isCustom: true,
      },
    ]
  }
}

export interface DateFilterOptions {
  suggestion: {
    items: (props: { query: string }) => DateFilterItem[] | Promise<DateFilterItem[]>
    render: () => {
      onStart: (props: SuggestionProps<DateFilterItem>) => void
      onUpdate: (props: SuggestionProps<DateFilterItem>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
}

/**
 * Custom match function for `after:` and `before:` triggers.
 * Detects when user types `after:` or `before:` followed by optional characters.
 *
 * Uses TipTap's Trigger interface which provides $position for cursor context.
 */
function findDateFilterMatch(config: {
  char: string
  allowSpaces: boolean
  allowedPrefixes: string[] | null
  startOfLine: boolean
  $position: import("@tiptap/pm/model").ResolvedPos
}) {
  const { $position } = config

  // Get text from start of text block to cursor
  const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, "\ufffc")

  // Match `after:` or `before:` at word boundary, allowing spaces in query
  // Also match after `?` since search mode uses `?` prefix
  // Popover stays open as long as there are matching items
  const match = textBefore.match(/(?:^|\s|\?)(after:|before:)(.*)$/)
  if (!match) return null

  const fullMatch = match[0]
  const triggerPart = match[1] // "after:" or "before:"
  const query = match[2] || "" // characters after the trigger

  // Calculate positions relative to document
  const matchStart = $position.pos - fullMatch.length + (fullMatch.startsWith(" ") ? 1 : 0)

  return {
    range: { from: matchStart, to: $position.pos },
    query,
    text: triggerPart + query,
  }
}

export const DateFilterExtension = Extension.create<DateFilterOptions>({
  name: "dateFilter",

  addOptions() {
    return {
      suggestion: {
        items: () => [],
        render: () => ({
          onStart: () => {},
          onUpdate: () => {},
          onExit: () => {},
          onKeyDown: () => false,
        }),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: DateFilterPluginKey,
        char: "after:", // Base trigger (we use custom matching for both after: and before:)
        allowSpaces: false,
        findSuggestionMatch: findDateFilterMatch,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const item = props as DateFilterItem
          // Insert plain text: "after:2025-01-15 " or "before:2025-01-15 "
          editor.chain().focus().deleteRange(range).insertContent(`${item.filterType}:${item.value} `).run()
        },
      }),
    ]
  },
})
