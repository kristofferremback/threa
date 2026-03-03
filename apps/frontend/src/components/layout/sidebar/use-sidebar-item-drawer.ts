import { useCallback, useRef, useState, type MouseEvent } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"

interface UseSidebarItemDrawerOptions {
  canOpenDrawer: boolean
  collapseOnMobile: () => void
}

export function useSidebarItemDrawer({ canOpenDrawer, collapseOnMobile }: UseSidebarItemDrawerOptions) {
  const isMobile = useIsMobile()
  const preventNavigationUntilRef = useRef(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const openDrawer = useCallback(() => {
    if (!canOpenDrawer) return
    preventNavigationUntilRef.current = Date.now() + 750
    setDrawerOpen(true)
  }, [canOpenDrawer])

  const longPress = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && canOpenDrawer,
  })

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (preventNavigationUntilRef.current > Date.now()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      collapseOnMobile()
    },
    [collapseOnMobile]
  )

  return {
    drawerOpen,
    setDrawerOpen,
    handleClick,
    isMobile,
    longPress,
  }
}
