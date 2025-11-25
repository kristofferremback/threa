import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"

interface DropdownProps {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: "left" | "right"
  direction?: "down" | "up"
}

export function Dropdown({ trigger, children, align = "right", direction = "down" }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  // Calculate position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const menuWidth = 160 // min-w-[160px]

      let top: number
      let left: number

      if (direction === "up") {
        top = rect.top - 4 // 4px gap
      } else {
        top = rect.bottom + 4 // 4px gap
      }

      if (align === "right") {
        left = rect.right - menuWidth
      } else {
        left = rect.left
      }

      // Ensure menu doesn't go off-screen
      left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))

      setPosition({ top, left })
    }
  }, [isOpen, align, direction])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape)
      return () => document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen])

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(!isOpen)
  }

  return (
    <div className="relative" ref={triggerRef}>
      <div onClick={handleTriggerClick}>{trigger}</div>
      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] py-1 rounded-lg shadow-lg min-w-[160px]"
            style={{
              top: direction === "up" ? "auto" : position.top,
              bottom: direction === "up" ? window.innerHeight - position.top : "auto",
              left: position.left,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
            onClick={() => setIsOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

interface DropdownItemProps {
  onClick: () => void
  children: React.ReactNode
  variant?: "default" | "danger"
  icon?: React.ReactNode
}

export function DropdownItem({ onClick, children, variant = "default", icon }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors hover:bg-white/5"
      style={{
        color: variant === "danger" ? "var(--danger)" : "var(--text-primary)",
      }}
    >
      {icon && <span style={{ color: variant === "danger" ? "var(--danger)" : "var(--text-muted)" }}>{icon}</span>}
      {children}
    </button>
  )
}

export function DropdownDivider() {
  return <div className="my-1" style={{ borderTop: "1px solid var(--border-subtle)" }} />
}
