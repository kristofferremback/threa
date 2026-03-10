import { createContext, useContext, useState, useCallback, useMemo } from "react"

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

  const setEditingInline = useCallback((editing: boolean) => {
    setIsEditingInline(editing)
  }, [])

  const value = useMemo(() => ({ isEditingInline, setEditingInline }), [isEditingInline, setEditingInline])

  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>
}
