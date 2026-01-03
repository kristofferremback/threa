import { useCallback, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap, EmojiEntry } from "@threa/types"

interface WorkspaceEmojiData {
  /** All available emojis in the workspace */
  emojis: EmojiEntry[]
  /** Emoji weights for personalized sorting (shortcode -> weight) */
  emojiWeights: Record<string, number>
  /** Look up emoji character by shortcode */
  toEmoji: (shortcode: string) => string | null
  /** Get full emoji entry by shortcode */
  getEmoji: (shortcode: string) => EmojiEntry | undefined
}

/**
 * Hook to look up emojis from workspace bootstrap data.
 * Subscribes to React Query cache updates so it re-renders when data loads.
 */
export function useWorkspaceEmoji(workspaceId: string): WorkspaceEmojiData {
  const queryClient = useQueryClient()

  // Subscribe to the bootstrap query cache - this will re-render when data changes
  // We don't fetch, just read from cache (the bootstrap query is made elsewhere)
  const { data: bootstrap } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    // Don't refetch - we just want to subscribe to cache updates
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const emojis = useMemo(() => {
    return bootstrap?.emojis ?? []
  }, [bootstrap])

  const emojiWeights = useMemo(() => {
    return bootstrap?.emojiWeights ?? {}
  }, [bootstrap])

  const emojiMap = useMemo(() => {
    const map = new Map<string, EmojiEntry>()
    for (const entry of emojis) {
      map.set(entry.shortcode, entry)
    }
    return map
  }, [emojis])

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
      emojis,
      emojiWeights,
      toEmoji,
      getEmoji,
    }),
    [emojis, emojiWeights, toEmoji, getEmoji]
  )
}
