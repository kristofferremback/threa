import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { Mentionable } from "@/components/editor/triggers/types"

type MentionType = "user" | "persona" | "broadcast" | "me"

interface MentionContextValue {
  getMentionType: (slug: string) => MentionType
}

const MentionContext = createContext<MentionContextValue | null>(null)

interface MentionProviderProps {
  mentionables: Mentionable[]
  children: ReactNode
}

/**
 * Provider that supplies mention type lookup for rendering.
 * Wraps markdown content to enable correct styling of @mentions.
 */
export function MentionProvider({ mentionables, children }: MentionProviderProps) {
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
    }
  }, [mentionables])

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
