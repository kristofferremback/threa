import { useState, useEffect } from "react"
import { useAuth } from "../../auth"
import { useBootstrapQuery } from "../../hooks"
import { initSocket } from "../../workers/socket-worker"
import { PersonaBuilder } from "./PersonaBuilder"
import { PersonaListSidebar } from "./PersonaListSidebar"
import { LoadingScreen, LoginScreen, ErrorScreen } from "./screens"
import type { Persona } from "../../../shared/api/persona-api"

interface PersonaBuilderPageProps {
  personaId?: string
}

export function PersonaBuilderPage({ personaId: initialPersonaId }: PersonaBuilderPageProps) {
  const { isAuthenticated, state } = useAuth()
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | undefined>(initialPersonaId)

  const {
    data: bootstrapData,
    isLoading: bootstrapLoading,
    error: bootstrapError,
  } = useBootstrapQuery({
    workspaceId: "default",
    enabled: isAuthenticated && state === "loaded",
  })

  // Initialize the message socket worker when we have workspace data
  useEffect(() => {
    if (bootstrapData?.workspace.id) {
      initSocket(bootstrapData.workspace.id)
    }
  }, [bootstrapData?.workspace.id])

  // Update URL when persona selection changes
  useEffect(() => {
    const newPath = selectedPersonaId ? `/personas/${selectedPersonaId}` : "/personas"
    if (window.location.pathname !== newPath) {
      window.history.pushState({}, "", newPath)
    }
  }, [selectedPersonaId])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const match = window.location.pathname.match(/^\/personas(?:\/([^/]+))?$/)
      if (match) {
        setSelectedPersonaId(match[1])
      }
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  const handleSelectPersona = (persona: Persona | null) => {
    setSelectedPersonaId(persona?.id)
  }

  const handleCreateNew = () => {
    setSelectedPersonaId(undefined)
  }

  const handleBack = () => {
    window.location.href = "/"
  }

  // Loading states
  if (state === "new" || state === "loading") {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  if (bootstrapLoading) {
    return <LoadingScreen />
  }

  if (bootstrapError || !bootstrapData) {
    return (
      <ErrorScreen message={bootstrapError || "Failed to load workspace"} onRetry={() => window.location.reload()} />
    )
  }

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      {/* Sidebar with persona list */}
      <PersonaListSidebar
        workspaceId={bootstrapData.workspace.id}
        selectedPersonaId={selectedPersonaId}
        onSelectPersona={handleSelectPersona}
        onCreateNew={handleCreateNew}
        onBack={handleBack}
      />

      {/* Main content - PersonaBuilder */}
      <div className="flex-1 min-w-0">
        <PersonaBuilder
          key={selectedPersonaId || "new"} // Force remount when switching personas
          workspaceId={bootstrapData.workspace.id}
          personaId={selectedPersonaId}
          users={bootstrapData.users.map((u) => ({ id: u.id, name: u.name || u.email, email: u.email }))}
          streams={bootstrapData.streams.map((s) => ({ id: s.id, name: s.name || "", slug: s.slug }))}
          onSaved={(persona) => {
            // After saving a new persona, navigate to it
            if (!selectedPersonaId) {
              setSelectedPersonaId(persona.id)
            }
          }}
        />
      </div>
    </div>
  )
}
