import { useState, useRef, useEffect } from "react"
import { Brain, ChevronDown, Bot, Lock } from "lucide-react"
import { StatusIndicator } from "../ui"

interface PersonaOption {
  id: string
  name: string
  slug: string
  avatarEmoji: string | null
  isDefault?: boolean
}

interface ThinkingSpaceHeaderProps {
  title: string
  isConnected: boolean
  personas: PersonaOption[]
  selectedPersonaId: string | null
  onPersonaChange: (personaId: string) => void
  isLocked: boolean
}

export function ThinkingSpaceHeader({
  title,
  isConnected,
  personas,
  selectedPersonaId,
  onPersonaChange,
  isLocked,
}: ThinkingSpaceHeaderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId) || personas.find((p) => p.isDefault)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = (personaId: string) => {
    onPersonaChange(personaId)
    setIsOpen(false)
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-3 flex-shrink-0"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-3">
        <Brain className="h-5 w-5" style={{ color: "rgb(139, 92, 246)" }} />
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {title || "Thinking Space"}
          </h2>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => !isLocked && setIsOpen(!isOpen)}
              disabled={isLocked}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{
                color: isLocked ? "var(--text-muted)" : "var(--text-secondary)",
                cursor: isLocked ? "default" : "pointer",
              }}
            >
              {selectedPersona ? (
                <>
                  {selectedPersona.avatarEmoji ? (
                    <span className="text-xs">{selectedPersona.avatarEmoji}</span>
                  ) : (
                    <Bot className="h-3 w-3" />
                  )}
                  <span>{selectedPersona.name}</span>
                </>
              ) : (
                <span>Select persona</span>
              )}
              {isLocked ? (
                <Lock className="h-3 w-3 ml-0.5" style={{ color: "var(--text-muted)" }} />
              ) : (
                <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              )}
            </button>

            {isOpen && !isLocked && (
              <div
                className="absolute left-0 top-full mt-1 w-56 py-1 rounded-lg shadow-lg z-50"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}
              >
                {personas.length === 0 ? (
                  <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    No personas available
                  </div>
                ) : (
                  personas.map((persona) => (
                    <button
                      key={persona.id}
                      onClick={() => handleSelect(persona.id)}
                      className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors hover:bg-[var(--hover-overlay)]"
                      style={{
                        background: persona.id === selectedPersonaId ? "var(--accent-secondary)" : undefined,
                      }}
                    >
                      {persona.avatarEmoji ? (
                        <span className="text-base">{persona.avatarEmoji}</span>
                      ) : (
                        <Bot className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
                      )}
                      <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                        {persona.name}
                      </span>
                      {persona.isDefault && (
                        <span
                          className="text-xs px-1 py-0.5 rounded ml-auto"
                          style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
                        >
                          Default
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <StatusIndicator status={isConnected ? "online" : "offline"} />
    </div>
  )
}
