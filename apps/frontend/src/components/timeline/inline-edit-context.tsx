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

  // Safety net: verify the ref-count against actual DOM state. If the count
  // leaked (e.g. due to unmount timing during app updates, drawer animation
  // races, or service worker activation), this auto-corrects the stale flag
  // so the message composer reappears without requiring a full page reload.
  //
  // Two triggers:
  // 1. visibilitychange — catches the case when user toggles apps
  // 2. Delayed verification — when count > 0, schedule a DOM check after a
  //    short delay. Normal edits complete or register within this window;
  //    a leaked count will be caught and corrected automatically.
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const verifyCount = useCallback(() => {
    if (countRef.current <= 0) return
    // MessageEditForm renders a [data-inline-edit] wrapper — if none exist
    // in the DOM but count > 0, the ref-count has drifted. Reset it.
    const activeSurfaces = document.querySelectorAll("[data-inline-edit]").length
    if (activeSurfaces === 0) {
      countRef.current = 0
      setCount(0)
    }
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      verifyCount()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [verifyCount])

  // When count rises above 0, schedule a deferred verification. This catches
  // leaked counts proactively — the user doesn't need to toggle apps. The
  // delay (2s) is long enough for a real edit form to mount and render its
  // [data-inline-edit] element, so we never false-positive on legitimate edits.
  useEffect(() => {
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current)
      verifyTimerRef.current = null
    }
    if (count > 0) {
      verifyTimerRef.current = setTimeout(verifyCount, 2000)
    }
    return () => {
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current)
        verifyTimerRef.current = null
      }
    }
  }, [count, verifyCount])

  const value = useMemo<InlineEditContextValue>(
    () => ({ isEditingInline: count > 0, registerInlineEdit }),
    [count, registerInlineEdit]
  )

  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>
}
