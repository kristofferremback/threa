import { useState, useEffect } from "react"
import { clsx } from "clsx"
import { Bot, Plus, ArrowLeft, Search, Star, Loader2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { io } from "socket.io-client"
import { personaApi, type PersonaMetadata } from "../../../shared/api/persona-api"
import type { Persona } from "../../../shared/api/persona-api"
import { usePersonasQuery, personaKeys } from "../../queries/usePersonasQuery"

interface PersonaListSidebarProps {
  workspaceId: string
  selectedPersonaId?: string
  onSelectPersona: (persona: Persona | null) => void
  onCreateNew: () => void
  onBack: () => void
}

export function PersonaListSidebar({
  workspaceId,
  selectedPersonaId,
  onSelectPersona,
  onCreateNew,
  onBack,
}: PersonaListSidebarProps) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectError, setSelectError] = useState<string | null>(null)

  // Use TanStack Query for personas
  const { personas, isLoading, error } = usePersonasQuery({ workspaceId })

  // Listen for persona change events to invalidate cache
  useEffect(() => {
    const socket = io({ withCredentials: true })

    socket.on("persona:changed", (data: { workspaceId: string; personaId: string; action: string }) => {
      if (data.workspaceId === workspaceId) {
        queryClient.invalidateQueries({ queryKey: personaKeys.workspace(workspaceId) })
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [workspaceId, queryClient])

  // Filter personas by search query
  const filteredPersonas = personas.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  // Sort: active first, then default, then by name
  const sortedPersonas = [...filteredPersonas].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    return a.name.localeCompare(b.name)
  })

  const handleSelectPersona = async (metadata: PersonaMetadata) => {
    try {
      setSelectError(null)
      const { persona } = await personaApi.getPersona(workspaceId, metadata.id)
      onSelectPersona(persona)
    } catch (err: any) {
      setSelectError(err.message)
    }
  }

  return (
    <div
      className="w-64 flex flex-col h-full"
      style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--bg-secondary)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <button
          onClick={onBack}
          className="p-1.5 rounded hover:bg-[var(--hover-overlay)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title="Back to workspace"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Bot className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        <h1 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          AI Personas
        </h1>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}
        >
          <Search className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search personas..."
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
      </div>

      {/* Create New Button */}
      <div className="px-3 py-2">
        <button
          onClick={onCreateNew}
          className={clsx(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            !selectedPersonaId ? "bg-[var(--accent-secondary)]" : "hover:bg-[var(--hover-overlay)]",
          )}
          style={{ color: "var(--accent-primary)" }}
        >
          <Plus className="h-4 w-4" />
          Create New Persona
        </button>
      </div>

      {/* Persona List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {selectError && (
          <div className="text-xs text-center py-2 px-2 mb-2" style={{ color: "var(--danger-text)" }}>
            {selectError}
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : error ? (
          <div className="text-xs text-center py-4 px-2" style={{ color: "var(--danger-text)" }}>
            {error}
          </div>
        ) : sortedPersonas.length === 0 ? (
          <div className="text-xs text-center py-8 px-2" style={{ color: "var(--text-muted)" }}>
            {searchQuery ? "No matching personas" : "No personas yet. Create your first one!"}
          </div>
        ) : (
          <div className="space-y-1">
            {sortedPersonas.map((persona) => (
              <button
                key={persona.id}
                onClick={() => handleSelectPersona(persona)}
                className={clsx(
                  "w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors",
                  selectedPersonaId === persona.id
                    ? "bg-[var(--accent-secondary)]"
                    : "hover:bg-[var(--hover-overlay)]",
                  !persona.isActive && "opacity-50",
                )}
              >
                <span className={clsx("text-lg shrink-0", !persona.isActive && "grayscale")}>
                  {persona.avatarEmoji || "🤖"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span
                      className="text-sm font-medium truncate"
                      style={{ color: persona.isActive ? "var(--text-primary)" : "var(--text-muted)" }}
                    >
                      {persona.name}
                    </span>
                    {persona.isDefault && (
                      <Star className="h-3 w-3 shrink-0" style={{ color: "var(--warning-text)" }} />
                    )}
                    {!persona.isActive && (
                      <span
                        className="text-xs px-1 py-0.5 rounded shrink-0"
                        style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
                      >
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    @{persona.slug}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
