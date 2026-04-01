import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react"

interface InlineEditContextValue {
  isEditingInline: boolean
  setEditingInline: (editing: boolean) => void
}

const InlineEditContext = createContext<InlineEditContextValue | null>(null)

export function useInlineEdit() {
  return useContext(InlineEditContext)
}

export function InlineEditProvider({
  children,
  resetKey,
}: {
  children: React.ReactNode
  /** When this key changes, inline edit state resets (e.g. stream navigation). */
  resetKey?: string
}) {
  const [isEditingInline, setIsEditingInline] = useState(false)

  // Reset when switching streams so a stuck flag from one stream
  // doesn't hide the input on the next stream.
  useEffect(() => {
    setIsEditingInline(false)
  }, [resetKey])

  // Reset inline edit state when the page becomes visible again (e.g. after
  // switching apps on mobile). The edit sheet/drawer may have closed while
  // the page was hidden, leaving the flag stuck and the message input hidden.
  // Empty deps: setIsEditingInline is a stable state setter, and calling it
  // with false when already false is a React no-op.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setIsEditingInline(false)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [])

  const setEditingInline = useCallback((editing: boolean) => {
    setIsEditingInline(editing)
  }, [])

  const value = useMemo(() => ({ isEditingInline, setEditingInline }), [isEditingInline, setEditingInline])

  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>
}
