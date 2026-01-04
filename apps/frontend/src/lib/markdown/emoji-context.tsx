import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { EmojiEntry } from "@threa/types"

type ToEmoji = (shortcode: string) => string | null

interface EmojiContextValue {
  toEmoji: ToEmoji
}

const EmojiContext = createContext<EmojiContextValue | null>(null)

interface EmojiProviderProps {
  emojis: EmojiEntry[]
  children: ReactNode
}

/**
 * Provider that supplies emoji lookup for rendering.
 * Wraps markdown content to enable :shortcode: → emoji conversion.
 */
export function EmojiProvider({ emojis, children }: EmojiProviderProps) {
  const value = useMemo<EmojiContextValue>(() => {
    const shortcodeToEmoji = new Map<string, string>()
    for (const entry of emojis) {
      shortcodeToEmoji.set(entry.shortcode, entry.emoji)
    }

    return {
      toEmoji: (shortcode: string) => {
        const normalized = shortcode.startsWith(":") && shortcode.endsWith(":") ? shortcode.slice(1, -1) : shortcode
        return shortcodeToEmoji.get(normalized) ?? null
      },
    }
  }, [emojis])

  return <EmojiContext.Provider value={value}>{children}</EmojiContext.Provider>
}

/**
 * Hook to get emoji lookup function.
 * Returns null converter if not within EmojiProvider (shortcodes stay as-is).
 */
export function useEmojiLookup(): ToEmoji {
  const context = useContext(EmojiContext)
  if (!context) {
    return () => null
  }
  return context.toEmoji
}
