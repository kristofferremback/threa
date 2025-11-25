import { useState } from "react"
import { AlertTriangle, Trash2, UserMinus, Archive } from "lucide-react"
import { Modal, ModalHeader, ModalFooter } from "./Modal"
import { Button } from "./Button"

type ConfirmVariant = "danger" | "warning" | "info"
type ConfirmIcon = "trash" | "user-minus" | "archive" | "warning"

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: string | React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
  icon?: ConfirmIcon
  isLoading?: boolean
}

const iconMap = {
  trash: Trash2,
  "user-minus": UserMinus,
  archive: Archive,
  warning: AlertTriangle,
}

const variantStyles: Record<ConfirmVariant, { bg: string; border: string; iconColor: string }> = {
  danger: {
    bg: "rgba(239, 68, 68, 0.1)",
    border: "var(--danger)",
    iconColor: "var(--danger)",
  },
  warning: {
    bg: "rgba(245, 158, 11, 0.1)",
    border: "var(--warning)",
    iconColor: "var(--warning)",
  },
  info: {
    bg: "rgba(59, 130, 246, 0.1)",
    border: "var(--accent-primary)",
    iconColor: "var(--accent-primary)",
  },
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  icon = "warning",
  isLoading: externalLoading,
}: ConfirmModalProps) {
  const [internalLoading, setInternalLoading] = useState(false)
  const isLoading = externalLoading ?? internalLoading

  const Icon = iconMap[icon]
  const styles = variantStyles[variant]

  const handleConfirm = async () => {
    setInternalLoading(true)
    try {
      await onConfirm()
    } finally {
      setInternalLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div
          className="p-4 rounded-lg flex items-start gap-3"
          style={{ background: styles.bg, border: `1px solid ${styles.border}` }}
        >
          <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: styles.iconColor }} />
          <div>
            <p className="font-medium" style={{ color: styles.iconColor }}>
              {title}
            </p>
            <div className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              {description}
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose} className="flex-1" disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={handleConfirm}
            loading={isLoading}
            className="flex-1"
          >
            {confirmText}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}

