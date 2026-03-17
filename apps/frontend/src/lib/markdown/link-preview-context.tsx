import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

interface LinkPreviewContextValue {
  hoveredLinkUrl: string | null
  setHoveredLinkUrl: (url: string | null) => void
}

const LinkPreviewContext = createContext<LinkPreviewContextValue | null>(null)

export function useLinkPreviewContext() {
  return useContext(LinkPreviewContext)
}

export function LinkPreviewProvider({ children }: { children: ReactNode }) {
  const [hoveredLinkUrl, setHoveredLinkUrl] = useState<string | null>(null)

  const handleSetHoveredUrl = useCallback((url: string | null) => {
    setHoveredLinkUrl(url)
  }, [])

  return (
    <LinkPreviewContext.Provider value={{ hoveredLinkUrl, setHoveredLinkUrl: handleSetHoveredUrl }}>
      {children}
    </LinkPreviewContext.Provider>
  )
}
