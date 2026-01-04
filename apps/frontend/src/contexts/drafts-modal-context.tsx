import { createContext, useContext } from "react"

interface DraftsModalContextValue {
  openDraftsModal: () => void
}

const DraftsModalContext = createContext<DraftsModalContextValue | null>(null)

export function DraftsModalProvider({
  children,
  openDraftsModal,
}: {
  children: React.ReactNode
  openDraftsModal: () => void
}) {
  return <DraftsModalContext.Provider value={{ openDraftsModal }}>{children}</DraftsModalContext.Provider>
}

export function useDraftsModal() {
  const context = useContext(DraftsModalContext)
  if (!context) {
    throw new Error("useDraftsModal must be used within DraftsModalProvider")
  }
  return context
}
