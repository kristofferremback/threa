import { createContext, useContext, useMemo, type ReactNode } from "react"

interface ChannelLinkContextValue {
  getChannelUrl: (slug: string) => string | null
}

const ChannelLinkContext = createContext<ChannelLinkContextValue | null>(null)

interface ChannelLinkProviderProps {
  workspaceId: string
  streams: ReadonlyArray<{ id: string; type: string; slug: string | null }>
  children: ReactNode
}

/**
 * Provider that supplies channel slug → URL lookup for rendered messages.
 * Wraps content to enable clickable #channel mentions.
 */
export function ChannelLinkProvider({ workspaceId, streams, children }: ChannelLinkProviderProps) {
  const value = useMemo<ChannelLinkContextValue>(() => {
    const slugToUrl = new Map<string, string>()
    for (const stream of streams) {
      if (stream.type === "channel" && stream.slug) {
        slugToUrl.set(stream.slug, `/w/${workspaceId}/s/${stream.id}`)
      }
    }
    return {
      getChannelUrl: (slug: string) => slugToUrl.get(slug) ?? null,
    }
  }, [workspaceId, streams])

  return <ChannelLinkContext.Provider value={value}>{children}</ChannelLinkContext.Provider>
}

/**
 * Hook to get channel URL from slug.
 * Returns null resolver if not within ChannelLinkProvider.
 */
export function useChannelUrl(): (slug: string) => string | null {
  const context = useContext(ChannelLinkContext)
  if (!context) {
    return () => null
  }
  return context.getChannelUrl
}
