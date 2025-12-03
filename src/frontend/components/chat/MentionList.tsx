import { forwardRef, useEffect, useImperativeHandle, useState, useCallback } from "react"
import { Avatar } from "../ui"
import { Hash, PlusCircle, Bot } from "lucide-react"

export interface MentionItem {
  id: string
  label: string
  type: "user" | "channel" | "crosspost" | "agent"
  // For users
  email?: string
  name?: string
  // For channels
  slug?: string
  // For agents
  avatarEmoji?: string
  description?: string
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (item) {
        command(item)
      }
    },
    [items, command],
  )

  const upHandler = useCallback(() => {
    setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
  }, [items.length])

  const downHandler = useCallback(() => {
    setSelectedIndex((prev) => (prev + 1) % items.length)
  }, [items.length])

  const enterHandler = useCallback(() => {
    selectItem(selectedIndex)
  }, [selectItem, selectedIndex])

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        upHandler()
        return true
      }
      if (event.key === "ArrowDown") {
        downHandler()
        return true
      }
      if (event.key === "Enter") {
        enterHandler()
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div
        className="rounded-lg p-3 text-sm shadow-lg"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        No results
      </div>
    )
  }

  return (
    <div
      className="rounded-lg py-1 shadow-lg overflow-hidden max-h-[240px] overflow-y-auto"
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-subtle)",
        minWidth: "200px",
      }}
    >
      {items.map((item, index) => (
        <button
          key={`${item.type}-${item.id}`}
          onClick={() => selectItem(index)}
          className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm transition-colors"
          style={{
            background: index === selectedIndex ? "var(--hover-overlay)" : "transparent",
            color: "var(--text-primary)",
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          {item.type === "user" ? (
            <>
              <Avatar name={item.name || item.label || ""} size="sm" />
              <span className="font-medium truncate">{item.name || item.label}</span>
            </>
          ) : item.type === "agent" ? (
            <>
              <div
                className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--accent-secondary)" }}
              >
                {item.avatarEmoji ? (
                  <span className="text-sm">{item.avatarEmoji}</span>
                ) : (
                  <Bot className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{item.label}</span>
                {item.description && (
                  <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {item.description}
                  </span>
                )}
              </div>
            </>
          ) : item.type === "crosspost" ? (
            <>
              <div
                className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--bg-tertiary)" }}
              >
                <PlusCircle className="w-3.5 h-3.5" style={{ color: "var(--accent-primary)" }} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">#{item.slug || item.label}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Cross-post to channel
                </span>
              </div>
            </>
          ) : (
            <>
              <div
                className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--bg-tertiary)" }}
              >
                <Hash className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
              </div>
              <span className="font-medium truncate">#{item.slug || item.label}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
})

MentionList.displayName = "MentionList"
