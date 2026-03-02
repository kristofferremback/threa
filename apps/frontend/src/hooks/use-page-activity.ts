import { useEffect, useState } from "react"

export interface PageActivityState {
  isVisible: boolean
  isFocused: boolean
  isActive: boolean
}

export function getPageActivityState(): PageActivityState {
  if (typeof document === "undefined") {
    return {
      isVisible: false,
      isFocused: false,
      isActive: false,
    }
  }

  const isVisible = document.visibilityState === "visible"
  const isFocused = document.hasFocus()

  return {
    isVisible,
    isFocused,
    isActive: isVisible && isFocused,
  }
}

export function usePageActivity(): PageActivityState {
  const [pageActivity, setPageActivity] = useState(getPageActivityState)

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return

    const updatePageActivity = () => {
      setPageActivity(getPageActivityState())
    }

    updatePageActivity()

    window.addEventListener("focus", updatePageActivity)
    window.addEventListener("blur", updatePageActivity)
    document.addEventListener("visibilitychange", updatePageActivity)

    return () => {
      window.removeEventListener("focus", updatePageActivity)
      window.removeEventListener("blur", updatePageActivity)
      document.removeEventListener("visibilitychange", updatePageActivity)
    }
  }, [])

  return pageActivity
}
