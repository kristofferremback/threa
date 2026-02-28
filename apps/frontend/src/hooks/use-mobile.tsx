import * as React from "react"

export const MOBILE_BREAKPOINT = 640

const mobileQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia(mobileQuery).matches)

  React.useEffect(() => {
    const mql = window.matchMedia(mobileQuery)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
