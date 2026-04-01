import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react"

interface InlineEditContextValue {
  isEditingInline: boolean
  setEditingInline: (editing: boolean) => void
}

const InlineEditContext = createContext<InlineEditContextValue | null>(null)

export function useInlineEdit() {
  return useContext(InlineEditContext)
}

export function InlineEditProvider({ children }: { children: React.ReactNode }) {
  const [isEditingInline, setIsEditingInline] = useState(false)

  // Reset inline edit state when the page becomes visible again (e.g. after
  // switching apps on mobile). The edit sheet/drawer may have closed while
  // the page was hidden, leaving the flag stuck and the message input hidden.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isEditingInline) {
        setIsEditingInline(false)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [isEditingInline])

  const setEditingInline = useCallback((editing: boolean) => {
    setIsEditingInline(editing)
  }, [])

  const value = useMemo(() => ({ isEditingInline, setEditingInline }), [isEditingInline, setEditingInline])

  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>
}
