import { useLayoutEffect, type RefObject } from "react"
import { useSidebar } from "@/contexts"
import { URGENCY_COLORS } from "./config"
import type { UrgencyLevel } from "./types"

/** Track item position for collapsed urgency strip */
export function useUrgencyTracking(
  itemRef: RefObject<HTMLAnchorElement | null>,
  streamId: string,
  urgency: UrgencyLevel,
  scrollContainerRef: RefObject<HTMLDivElement | null> | undefined
) {
  const { setUrgencyBlock, sidebarHeight, scrollContainerOffset } = useSidebar()

  useLayoutEffect(() => {
    const el = itemRef.current
    const container = scrollContainerRef?.current
    if (!el || !container || sidebarHeight === 0) return

    if (urgency === "quiet") {
      setUrgencyBlock(streamId, null)
      return
    }

    const position = (scrollContainerOffset + el.offsetTop) / sidebarHeight
    const height = el.offsetHeight / sidebarHeight

    setUrgencyBlock(streamId, {
      position,
      height,
      color: URGENCY_COLORS[urgency],
    })

    return () => setUrgencyBlock(streamId, null)
  }, [streamId, urgency, scrollContainerRef, sidebarHeight, scrollContainerOffset, setUrgencyBlock, itemRef])
}
