import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap, EmojiEntry } from "@threa/types"

interface EmojiLookup {
  toEmoji: (shortcode: string) => string | null
  getEmoji: (shortcode: string) => EmojiEntry | undefined
}

/**
 * Hook to look up emojis from cached workspace data.
 * Uses React Query cache for synchronous lookups.
 */
export function useWorkspaceEmoji(workspaceId: string): EmojiLookup {
  const queryClient = useQueryClient()

  const getBootstrapData = useCallback(() => {
    return queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
  }, [queryClient, workspaceId])

  const emojiMap = useMemo(() => {
    const bootstrap = getBootstrapData()
    const map = new Map<string, EmojiEntry>()
    for (const entry of bootstrap?.emojis ?? []) {
      map.set(entry.shortcode, entry)
    }
    return map
  }, [getBootstrapData])

  const getEmoji = useCallback(
    (shortcode: string): EmojiEntry | undefined => {
      const normalized = shortcode.startsWith(":") && shortcode.endsWith(":") ? shortcode.slice(1, -1) : shortcode
      return emojiMap.get(normalized)
    },
    [emojiMap]
  )

  const toEmoji = useCallback(
    (shortcode: string): string | null => {
      const entry = getEmoji(shortcode)
      return entry?.emoji ?? null
    },
    [getEmoji]
  )

  return useMemo(
    () => ({
      toEmoji,
      getEmoji,
    }),
    [toEmoji, getEmoji]
  )
}
