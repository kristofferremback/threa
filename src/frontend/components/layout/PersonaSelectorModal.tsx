import { useState } from "react"
import { Brain, Bot } from "lucide-react"
import { Modal, ModalHeader, ModalFooter, Button } from "../ui"

interface PersonaOption {
  id: string
  name: string
  slug: string
  description: string
  avatarEmoji: string | null
  isDefault?: boolean
}

interface PersonaSelectorModalProps {
  open: boolean
  onClose: () => void
  onSelect: (personaId: string) => void
  personas: PersonaOption[]
}

export function PersonaSelectorModal({ open, onClose, onSelect, personas }: PersonaSelectorModalProps) {
  // Find the default persona (Ariadne) and set as initial selection
  const defaultPersona = personas.find((p) => p.isDefault) || personas[0]
  const [selectedId, setSelectedId] = useState<string | null>(defaultPersona?.id ?? null)

  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId)
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <ModalHeader>Start thinking with...</ModalHeader>

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {personas.length === 0 ? (
          <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
            <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No personas available</p>
          </div>
        ) : (
          personas.map((persona) => (
            <button
              key={persona.id}
              onClick={() => setSelectedId(persona.id)}
              className="w-full text-left p-3 rounded-lg flex items-start gap-3 transition-colors"
              style={{
                background: selectedId === persona.id ? "var(--accent-primary-muted)" : "var(--bg-tertiary)",
                border: `2px solid ${selectedId === persona.id ? "var(--accent-primary)" : "transparent"}`,
              }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--bg-secondary)" }}
              >
                {persona.avatarEmoji ? (
                  <span className="text-xl">{persona.avatarEmoji}</span>
                ) : (
                  <Bot className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                    {persona.name}
                  </span>
                  {persona.isDefault && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}
                    >
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                  {persona.description || `@${persona.slug}`}
                </p>
              </div>
            </button>
          ))
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={!selectedId || personas.length === 0}>
          Start thinking
        </Button>
      </ModalFooter>
    </Modal>
  )
}
