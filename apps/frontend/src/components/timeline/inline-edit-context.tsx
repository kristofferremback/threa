import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react"

interface InlineEditContextValue {
  isEditingInline: boolean
  /**
   * Register a mounted inline edit surface. Returns a disposer that must be
   * called when the surface unmounts. Prefer `useInlineEditRegistration`,
   * which wraps this in a `useEffect` so callers cannot leak the flag.
   */
  registerInlineEdit: () => () => void
}

const InlineEditContext = createContext<InlineEditContextValue | null>(null)

export function useInlineEdit() {
  return useContext(InlineEditContext)
}

/**
 * Mark this component as a mounted inline edit surface while `active` is true.
 * The context counts active surfaces, so the flag is automatically released on
 * unmount or when `active` flips to false — there is no way to leak it.
 */
export function useInlineEditRegistration(active: boolean) {
  const ctx = useInlineEdit()
  const register = ctx?.registerInlineEdit
  useEffect(() => {
    if (!active || !register) return
    const dispose = register()
    return dispose
    // Depend only on `active` and the stable registrar — NOT on the context
    // value object, whose identity changes on every count update and would
    // cause a cleanup/re-register feedback loop.
  }, [active, register])
}

export function InlineEditProvider({
  children,
  resetKey,
}: {
  children: React.ReactNode
  /** When this key changes, inline edit count resets (e.g. stream navigation). */
  resetKey?: string
}) {
  const [count, setCount] = useState(0)
  // Mirror the state in a ref so register/dispose callbacks never capture a
  // stale count and can remain referentially stable.
  const countRef = useRef(0)

  const registerInlineEdit = useCallback(() => {
    countRef.current += 1
    setCount(countRef.current)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      countRef.current = Math.max(0, countRef.current - 1)
      setCount(countRef.current)
    }
  }, [])

  // Safety net: on stream navigation, force the count back to zero. With
  // ref-counting this should already be true (every MessageEditForm that
  // was mounted on the old stream unmounts and releases its registration),
  // but we keep the reset as defense-in-depth against future misuse.
  //
  // Skip the initial mount: child effects run before parent effects, so any
  // surface that registered during the same commit would be clobbered.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    countRef.current = 0
    setCount(0)
  }, [resetKey])

  const value = useMemo<InlineEditContextValue>(
    () => ({ isEditingInline: count > 0, registerInlineEdit }),
    [count, registerInlineEdit]
  )

  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>
}
