import { cn } from "@/lib/utils"
import { PanelResizeHandle } from "./panel-resize-handle"

interface ThreadPanelSlotProps {
  displayWidth: number
  panelWidth: number
  shouldAnimate: boolean
  showContent: boolean
  isResizing: boolean
  maxWidth: number
  onTransitionEnd: (e: React.TransitionEvent) => void
  onResizeStart: (e: React.MouseEvent) => void
  onResizeKeyDown: (e: React.KeyboardEvent) => void
  children: React.ReactNode
}

export function ThreadPanelSlot({
  displayWidth,
  panelWidth,
  shouldAnimate,
  showContent,
  isResizing,
  maxWidth,
  onTransitionEnd,
  onResizeStart,
  onResizeKeyDown,
  children,
}: ThreadPanelSlotProps) {
  return (
    <div
      data-testid="panel"
      className={cn("flex-shrink-0 overflow-hidden", shouldAnimate && "transition-[width] duration-200 ease-out")}
      style={{ width: displayWidth }}
      onTransitionEnd={onTransitionEnd}
    >
      {showContent && (
        <div className="flex h-full" style={{ width: panelWidth, minWidth: panelWidth }}>
          <PanelResizeHandle
            isResizing={isResizing}
            panelWidth={panelWidth}
            maxWidth={maxWidth}
            onMouseDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
          />
          <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
        </div>
      )}
    </div>
  )
}
