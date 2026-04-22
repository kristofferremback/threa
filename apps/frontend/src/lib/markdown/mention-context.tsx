import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { Mentionable } from "@/components/editor/triggers/types"

export type MentionType = "user" | "persona" | "bot" | "broadcast" | "me"

interface MentionContextValue {
  getMentionType: (slug: string) => MentionType
  onMentionClick?: (slug: string, type: MentionType) => void
}

const MentionContext = createContext<MentionContextValue | null>(null)

interface MentionProviderProps {
  mentionables: Mentionable[]
  onMentionClick?: (slug: string, type: MentionType) => void
  children: ReactNode
}

/**
 * Provider that supplies mention type lookup for rendering.
 * Wraps markdown content to enable correct styling of @mentions.
 */
export function MentionProvider({ mentionables, onMentionClick, children }: MentionProviderProps) {
  const value = useMemo<MentionContextValue>(() => {
    const slugToType = new Map<string, MentionType>()
    for (const m of mentionables) {
      slugToType.set(m.slug, m.isCurrentUser ? "me" : m.type)
    }
    // Add broadcast slugs as fallback
    slugToType.set("here", "broadcast")
    slugToType.set("channel", "broadcast")

    return {
      getMentionType: (slug: string) => slugToType.get(slug) ?? "user",
      onMentionClick,
    }
  }, [mentionables, onMentionClick])

  return <MentionContext.Provider value={value}>{children}</MentionContext.Provider>
}

/**
 * Hook to get mention type lookup function.
 * Falls back to basic lookup if not within MentionProvider.
 */
export function useMentionType(): (slug: string) => MentionType {
  const context = useContext(MentionContext)
  if (!context) {
    // Fallback: only knows broadcast slugs
    return (slug: string) => {
      if (slug === "here" || slug === "channel") return "broadcast"
      return "user"
    }
  }
  return context.getMentionType
}

/**
 * Hook to get the optional mention click handler.
 */
export function useMentionClick(): ((slug: string, type: MentionType) => void) | undefined {
  const context = useContext(MentionContext)
  return context?.onMentionClick
}
