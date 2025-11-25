import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

interface ModalProps {
  open?: boolean
  isOpen?: boolean
  onClose: () => void
  children: ReactNode
  size?: "sm" | "md" | "lg" | "xl"
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
}

export function Modal({ open, isOpen, onClose, children, size = "md" }: ModalProps) {
  const isVisible = open ?? isOpen ?? false

  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isVisible, onClose])

  if (!isVisible) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`w-full ${sizeClasses[size]} rounded-2xl animate-fade-in overflow-hidden`}
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

interface ModalHeaderProps {
  children: ReactNode
}

export function ModalHeader({ children }: ModalHeaderProps) {
  return (
    <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
      {children}
    </h2>
  )
}

interface ModalFooterProps {
  children: ReactNode
}

export function ModalFooter({ children }: ModalFooterProps) {
  return <div className="flex gap-3 pt-2">{children}</div>
}
