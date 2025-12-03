import { useState, useCallback, useEffect, useRef } from "react"
import { clsx } from "clsx"
import { Trash2, Play, RotateCcw, ChevronDown, ChevronUp, Save, Bot, AlertCircle, DollarSign, Lock, Power } from "lucide-react"
import { toast } from "sonner"
import {
  personaApi,
  type Persona,
  type CreatePersonaInput,
  type UpdatePersonaInput,
  type ToolName,
  AVAILABLE_TOOLS,
  TOOL_DESCRIPTIONS,
} from "../../../shared/api/persona-api"
import { streamApi } from "../../../shared/api/stream-api"
import { StreamInterface } from "../StreamInterface"
import type { Stream } from "../../types"

interface PersonaBuilderProps {
  workspaceId: string
  personaId?: string
  users?: Array<{ id: string; name: string; email: string }>
  streams?: Array<{ id: string; name: string; slug: string | null }>
  onSaved?: (persona: Persona) => void
}

// Model options with cost tiers
const MODEL_OPTIONS = [
  {
    value: "anthropic:claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    description: "Fast, efficient, great for most tasks",
    costTier: "low" as const,
  },
  {
    value: "anthropic:claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    description: "Balanced intelligence and speed",
    costTier: "medium" as const,
  },
  {
    value: "openai:gpt-4o-mini",
    label: "GPT-4o Mini",
    description: "Fast and affordable OpenAI model",
    costTier: "low" as const,
  },
  {
    value: "openai:gpt-4o",
    label: "GPT-4o",
    description: "Powerful OpenAI model with vision",
    costTier: "high" as const,
  },
  {
    value: "openai:gpt-4-turbo",
    label: "GPT-4 Turbo",
    description: "OpenAI's fast GPT-4 variant",
    costTier: "high" as const,
  },
]

const COST_TIER_COLORS = {
  low: "var(--success-text)",
  medium: "var(--warning-text)",
  high: "var(--danger-text)",
}

const COST_TIER_LABELS = {
  low: "Budget-friendly",
  medium: "Moderate cost",
  high: "Higher cost - uses quota faster",
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Be concise and helpful in your responses.

When helping users:
- Listen carefully to their questions
- Provide clear, actionable answers
- Ask clarifying questions when needed
- Be honest about what you don't know`

// Draft state stored in localStorage
interface DraftState {
  name: string
  slug: string
  description: string
  avatarEmoji: string
  systemPrompt: string
  enabledTools: ToolName[]
  model: string
  temperature: number
  maxTokens: number
  testStreamId: string | null
  lastUpdated: number
}

const DRAFT_STORAGE_KEY = "persona_draft"
const DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function getDraftKey(workspaceId: string, personaId?: string): string {
  return `${DRAFT_STORAGE_KEY}_${workspaceId}_${personaId || "new"}`
}

function loadDraft(workspaceId: string, personaId?: string): DraftState | null {
  try {
    const key = getDraftKey(workspaceId, personaId)
    const stored = localStorage.getItem(key)
    if (!stored) return null

    const draft = JSON.parse(stored) as DraftState
    // Check if draft is expired
    if (Date.now() - draft.lastUpdated > DRAFT_EXPIRY_MS) {
      localStorage.removeItem(key)
      return null
    }
    return draft
  } catch {
    return null
  }
}

function saveDraft(workspaceId: string, personaId: string | undefined, state: Omit<DraftState, "lastUpdated">) {
  try {
    const key = getDraftKey(workspaceId, personaId)
    const draft: DraftState = { ...state, lastUpdated: Date.now() }
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Ignore storage errors
  }
}

function clearDraft(workspaceId: string, personaId?: string) {
  try {
    const key = getDraftKey(workspaceId, personaId)
    localStorage.removeItem(key)
  } catch {
    // Ignore storage errors
  }
}

export function PersonaBuilder({
  workspaceId,
  personaId,
  users = [],
  streams = [],
  onSaved,
}: PersonaBuilderProps) {
  // Form state
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [avatarEmoji, setAvatarEmoji] = useState("")
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [enabledTools, setEnabledTools] = useState<ToolName[]>([...AVAILABLE_TOOLS])
  const [model, setModel] = useState(MODEL_OPTIONS[0]?.value || "anthropic:claude-haiku-4-5-20251001")
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [isDefault, setIsDefault] = useState(false)
  const [isActive, setIsActive] = useState(true)

  // UI state
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTogglingActive, setIsTogglingActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Test chat state
  const [testStreamId, setTestStreamId] = useState<string | null>(null)
  const [testStream, setTestStream] = useState<Stream | null>(null)
  const [isCreatingTestStream, setIsCreatingTestStream] = useState(false)

  // Original state for comparison (to detect changes)
  const originalStateRef = useRef<string>("")

  // Auto-save draft on changes (debounced)
  const draftTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const getCurrentState = useCallback(() => ({
    name,
    slug,
    description,
    avatarEmoji,
    systemPrompt,
    enabledTools,
    model,
    temperature,
    maxTokens,
    testStreamId,
  }), [name, slug, description, avatarEmoji, systemPrompt, enabledTools, model, temperature, maxTokens, testStreamId])

  // Check for unsaved changes
  useEffect(() => {
    if (originalStateRef.current) {
      const currentState = JSON.stringify(getCurrentState())
      setHasUnsavedChanges(currentState !== originalStateRef.current)
    }
  }, [getCurrentState])

  // Auto-save draft
  useEffect(() => {
    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current)
    }

    draftTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges || !personaId) {
        saveDraft(workspaceId, personaId, getCurrentState())
        setHasDraft(true)
      }
    }, 2000)

    return () => {
      if (draftTimeoutRef.current) {
        clearTimeout(draftTimeoutRef.current)
      }
    }
  }, [getCurrentState, hasUnsavedChanges, workspaceId, personaId])

  // Load existing persona or draft
  useEffect(() => {
    const loadData = async () => {
      // First check for draft
      const draft = loadDraft(workspaceId, personaId)

      if (personaId) {
        setIsLoading(true)
        try {
          const { persona } = await personaApi.getPersona(workspaceId, personaId)

          // If we have a draft that's newer than the last save, use the draft
          // Also check that draft has meaningful content (not just default values)
          const draftHasContent = draft && (
            draft.name !== "" ||
            draft.description !== "" ||
            draft.systemPrompt !== DEFAULT_SYSTEM_PROMPT
          )

          if (draftHasContent && draft.lastUpdated > new Date(persona.updatedAt).getTime()) {
            setName(draft.name)
            setSlug(draft.slug)
            setDescription(draft.description)
            setAvatarEmoji(draft.avatarEmoji)
            setSystemPrompt(draft.systemPrompt)
            setEnabledTools(draft.enabledTools)
            setModel(draft.model)
            setTemperature(draft.temperature)
            setMaxTokens(draft.maxTokens)
            setTestStreamId(draft.testStreamId)
            setHasDraft(true)
            toast.info("Restored unsaved draft")
          } else {
            // Use saved persona data
            setName(persona.name)
            setSlug(persona.slug)
            setDescription(persona.description)
            setAvatarEmoji(persona.avatarEmoji || "")
            setSystemPrompt(persona.systemPrompt)
            setEnabledTools(persona.enabledTools || [...AVAILABLE_TOOLS])
            setModel(persona.model)
            setTemperature(persona.temperature)
            setMaxTokens(persona.maxTokens)
            setIsDefault(persona.isDefault)
            setIsActive(persona.isActive)
            // Clear stale draft if persona is newer
            if (draft) {
              clearDraft(workspaceId, personaId)
            }
          }

          // Store original state for change detection
          originalStateRef.current = JSON.stringify({
            name: persona.name,
            slug: persona.slug,
            description: persona.description,
            avatarEmoji: persona.avatarEmoji || "",
            systemPrompt: persona.systemPrompt,
            enabledTools: persona.enabledTools || [...AVAILABLE_TOOLS],
            model: persona.model,
            temperature: persona.temperature,
            maxTokens: persona.maxTokens,
            testStreamId: null,
          })
        } catch (err: any) {
          setError(err.message)
        } finally {
          setIsLoading(false)
        }
      } else if (draft) {
        // New persona with draft - only restore if it has meaningful content
        const draftHasContent = draft.name !== "" || draft.description !== "" || draft.systemPrompt !== DEFAULT_SYSTEM_PROMPT

        if (draftHasContent) {
          setName(draft.name)
          setSlug(draft.slug)
          setDescription(draft.description)
          setAvatarEmoji(draft.avatarEmoji)
          setSystemPrompt(draft.systemPrompt)
          setEnabledTools(draft.enabledTools)
          setModel(draft.model)
          setTemperature(draft.temperature)
          setMaxTokens(draft.maxTokens)
          setTestStreamId(draft.testStreamId)
          setHasDraft(true)
          toast.info("Restored unsaved draft")
        } else {
          // Draft has no meaningful content, clear it
          clearDraft(workspaceId, personaId)
        }
      }
    }

    loadData()
  }, [workspaceId, personaId])

  // Auto-generate slug from name
  useEffect(() => {
    if (!personaId && name) {
      const generatedSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      setSlug(generatedSlug)
    }
  }, [name, personaId])

  // Toggle tool selection
  const toggleTool = (tool: ToolName) => {
    setEnabledTools((prev) => (prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]))
  }

  // Discard draft
  const discardDraft = () => {
    clearDraft(workspaceId, personaId)
    setHasDraft(false)
    setHasUnsavedChanges(false)
    window.location.reload()
  }

  // Toggle persona active status
  const toggleActive = async () => {
    if (!personaId) return
    setIsTogglingActive(true)
    try {
      const { persona } = await personaApi.updatePersona(workspaceId, personaId, { isActive: !isActive })
      setIsActive(persona.isActive)
      onSaved?.(persona)
      toast.success(persona.isActive ? "Persona enabled" : "Persona disabled")
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`)
    } finally {
      setIsTogglingActive(false)
    }
  }

  // Create test stream with current persona config
  const createTestStream = useCallback(async () => {
    setIsCreatingTestStream(true)
    setError(null)

    try {
      // First save or create the persona to get an ID
      let savedPersonaId: string

      if (!personaId) {
        // Create persona first
        const input: CreatePersonaInput = {
          name: name || "Test Persona",
          slug: slug || `test-${Date.now()}`,
          description: description || "Test persona",
          avatarEmoji: avatarEmoji || undefined,
          systemPrompt,
          enabledTools: enabledTools.length === AVAILABLE_TOOLS.length ? undefined : enabledTools,
          model,
          temperature,
          maxTokens,
        }
        const { persona } = await personaApi.createPersona(workspaceId, input)
        savedPersonaId = persona.id
        onSaved?.(persona)
        clearDraft(workspaceId, personaId)
        originalStateRef.current = JSON.stringify(getCurrentState())
        setHasUnsavedChanges(false)
        toast.success("Persona created!")
      } else {
        // Update existing persona
        savedPersonaId = personaId
        const input: UpdatePersonaInput = {
          name,
          slug,
          description,
          avatarEmoji: avatarEmoji || null,
          systemPrompt,
          enabledTools: enabledTools.length === AVAILABLE_TOOLS.length ? null : enabledTools,
          model,
          temperature,
          maxTokens,
        }
        const { persona } = await personaApi.updatePersona(workspaceId, savedPersonaId, input)
        onSaved?.(persona)
        clearDraft(workspaceId, personaId)
        originalStateRef.current = JSON.stringify(getCurrentState())
        setHasUnsavedChanges(false)
        toast.success("Persona saved!")
      }

      // Create a test thinking space with this persona
      const stream = await streamApi.createThinkingSpace(workspaceId, `Test: ${name || "Persona"}`, savedPersonaId)

      setTestStreamId(stream.id)
      setTestStream(stream as Stream)
    } catch (err: any) {
      setError(err.message)
      toast.error(`Failed: ${err.message}`)
    } finally {
      setIsCreatingTestStream(false)
    }
  }, [workspaceId, personaId, name, slug, description, avatarEmoji, systemPrompt, enabledTools, model, temperature, maxTokens, onSaved, getCurrentState])

  // Clear test chat (archive the stream and create new one)
  const clearTestChat = useCallback(async () => {
    if (testStreamId) {
      try {
        // Archive the old test stream
        await streamApi.archiveStream(workspaceId, testStreamId)
      } catch {
        // Ignore errors when archiving
      }
    }
    setTestStreamId(null)
    setTestStream(null)
    // Create a new test stream
    createTestStream()
  }, [testStreamId, workspaceId, createTestStream])

  // Save persona
  const handleSave = async () => {
    if (!name || !slug || !description || !systemPrompt) {
      setError("Please fill in all required fields")
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      if (personaId) {
        const input: UpdatePersonaInput = {
          name,
          slug,
          description,
          avatarEmoji: avatarEmoji || null,
          systemPrompt,
          enabledTools: enabledTools.length === AVAILABLE_TOOLS.length ? null : enabledTools,
          model,
          temperature,
          maxTokens,
        }
        const { persona } = await personaApi.updatePersona(workspaceId, personaId, input)
        onSaved?.(persona)
        clearDraft(workspaceId, personaId)
        originalStateRef.current = JSON.stringify(getCurrentState())
        setHasUnsavedChanges(false)
        setHasDraft(false)
        toast.success("Persona saved!")
      } else {
        const input: CreatePersonaInput = {
          name,
          slug,
          description,
          avatarEmoji: avatarEmoji || undefined,
          systemPrompt,
          enabledTools: enabledTools.length === AVAILABLE_TOOLS.length ? undefined : enabledTools,
          model,
          temperature,
          maxTokens,
        }
        const { persona } = await personaApi.createPersona(workspaceId, input)
        onSaved?.(persona)
        clearDraft(workspaceId, personaId)
        setHasUnsavedChanges(false)
        setHasDraft(false)
        toast.success("Persona created!")
      }
    } catch (err: any) {
      setError(err.message)
      toast.error(`Failed: ${err.message}`)
    } finally {
      setIsSaving(false)
    }
  }

  // Get the selected model's cost tier info
  const selectedModel = MODEL_OPTIONS.find((m) => m.value === model)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center" style={{ color: "var(--text-muted)" }}>
          <Bot className="h-12 w-12 mx-auto mb-4 animate-pulse" />
          <p>Loading persona...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full" style={{ background: "var(--bg-primary)" }}>
      {/* Left Panel - Configuration */}
      <div
        className="w-1/2 flex flex-col overflow-hidden"
        style={{ borderRight: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-secondary)" }}
        >
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {personaId ? (isDefault ? "View Persona" : "Edit Persona") : "Create Persona"}
            </h2>
            {isDefault && (
              <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                <Lock className="h-3 w-3" />
                Managed by Threa
              </span>
            )}
            {!isDefault && hasUnsavedChanges && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>
                Unsaved
              </span>
            )}
            {!isDefault && hasDraft && !hasUnsavedChanges && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                Draft saved
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Enable/Disable Toggle */}
            {personaId && (
              <button
                onClick={toggleActive}
                disabled={isTogglingActive}
                className={clsx(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  isActive
                    ? "hover:bg-[var(--danger-bg)]"
                    : "hover:bg-[var(--success-bg)]",
                )}
                style={{
                  border: "1px solid var(--border-default)",
                  color: isActive ? "var(--text-muted)" : "var(--success-text)",
                }}
              >
                <Power className="h-3 w-3" />
                {isTogglingActive ? "..." : isActive ? "Disable" : "Enable"}
              </button>
            )}
            {!isDefault && hasDraft && (
              <button
                onClick={discardDraft}
                className="flex items-center gap-1 text-xs hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                <Trash2 className="h-3 w-3" />
                Discard draft
              </button>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div
              className="p-3 rounded-md text-sm flex items-start gap-2"
              style={{ background: "var(--danger-bg)", color: "var(--danger-text)" }}
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Name {!isDefault && "*"}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Support Agent"
                readOnly={isDefault}
                disabled={isDefault}
                className={clsx(
                  "w-full px-3 py-2 rounded-md text-sm outline-none transition-colors",
                  isDefault && "cursor-not-allowed opacity-70"
                )}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Slug (for @mentions) {!isDefault && "*"}
                </label>
                <div className="flex items-center">
                  <span className="text-sm mr-1" style={{ color: "var(--text-muted)" }}>
                    @
                  </span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="support-agent"
                    readOnly={isDefault}
                    disabled={isDefault}
                    className={clsx(
                      "flex-1 px-3 py-2 rounded-md text-sm outline-none transition-colors",
                      isDefault && "cursor-not-allowed opacity-70"
                    )}
                    style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              </div>

              <div className="w-20">
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Avatar
                </label>
                <input
                  type="text"
                  value={avatarEmoji}
                  onChange={(e) => setAvatarEmoji(e.target.value)}
                  placeholder="robot"
                  maxLength={2}
                  readOnly={isDefault}
                  disabled={isDefault}
                  className={clsx(
                    "w-full px-3 py-2 rounded-md text-center text-lg outline-none transition-colors",
                    isDefault && "cursor-not-allowed opacity-70"
                  )}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Description {!isDefault && "*"}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A helpful agent for customer support questions"
                readOnly={isDefault}
                disabled={isDefault}
                className={clsx(
                  "w-full px-3 py-2 rounded-md text-sm outline-none transition-colors",
                  isDefault && "cursor-not-allowed opacity-70"
                )}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              System Prompt {!isDefault && "*"}
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful AI assistant..."
              rows={12}
              readOnly={isDefault}
              disabled={isDefault}
              className={clsx(
                "w-full px-3 py-2 rounded-md text-sm outline-none transition-colors font-mono resize-none",
                isDefault && "cursor-not-allowed opacity-70"
              )}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* Tools */}
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              Enabled Tools
            </label>
            <div className={clsx("grid grid-cols-2 gap-2", isDefault && "opacity-70")}>
              {AVAILABLE_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className={clsx(
                    "flex items-start gap-2 p-2 rounded-md transition-colors",
                    isDefault ? "cursor-not-allowed" : "cursor-pointer",
                    enabledTools.includes(tool)
                      ? "bg-[var(--accent-secondary)]"
                      : isDefault ? "bg-[var(--bg-tertiary)]" : "bg-[var(--bg-tertiary)] hover:bg-[var(--hover-overlay)]",
                  )}
                  style={{ border: "1px solid var(--border-subtle)" }}
                >
                  <input
                    type="checkbox"
                    checked={enabledTools.includes(tool)}
                    onChange={() => !isDefault && toggleTool(tool)}
                    disabled={isDefault}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium" style={{ color: enabledTools.includes(tool) ? "white" : "var(--text-primary)" }}>
                      {TOOL_DESCRIPTIONS[tool].name}
                    </div>
                    <div className="text-xs truncate" style={{ color: enabledTools.includes(tool) ? "rgba(255,255,255,0.8)" : "var(--text-muted)" }}>
                      {TOOL_DESCRIPTIONS[tool].description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Advanced Settings */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className={clsx("mt-3 space-y-3 p-3 rounded-md", isDefault && "opacity-70")} style={{ background: "var(--bg-tertiary)" }}>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                    Model
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={isDefault}
                    className={clsx(
                      "w-full px-3 py-2 rounded-md text-sm outline-none",
                      isDefault && "cursor-not-allowed"
                    )}
                    style={{
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Model description and cost warning */}
                  {selectedModel && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {selectedModel.description}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-3 w-3" style={{ color: COST_TIER_COLORS[selectedModel.costTier] }} />
                        <span className="text-xs" style={{ color: COST_TIER_COLORS[selectedModel.costTier] }}>
                          {COST_TIER_LABELS[selectedModel.costTier]}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                    Temperature: {temperature.toFixed(1)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    disabled={isDefault}
                    className={clsx("w-full", isDefault && "cursor-not-allowed")}
                  />
                  <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2048)}
                    min={256}
                    max={8192}
                    disabled={isDefault}
                    className={clsx(
                      "w-full px-3 py-2 rounded-md text-sm outline-none",
                      isDefault && "cursor-not-allowed"
                    )}
                    style={{
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        {!isDefault && (
          <div
            className="flex items-center justify-between px-4 py-3 gap-3"
            style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-secondary)" }}
          >
            <button
              onClick={handleSave}
              disabled={isSaving || !name || !slug || !description || !systemPrompt}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                isSaving || !name || !slug || !description || !systemPrompt
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:opacity-90",
              )}
              style={{
                background: "var(--accent-primary)",
                color: "white",
              }}
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Saving..." : "Save Persona"}
            </button>

            <button
              onClick={createTestStream}
              disabled={isCreatingTestStream || !name || !systemPrompt}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                isCreatingTestStream || !name || !systemPrompt
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-[var(--hover-overlay)]",
              )}
              style={{
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            >
              <Play className="h-4 w-4" />
              {isCreatingTestStream ? "Starting..." : "Save & Test"}
            </button>
          </div>
        )}
      </div>

      {/* Right Panel - Test Chat */}
      <div className="w-1/2 flex flex-col">
        {testStreamId && testStream ? (
          <>
            {/* Test Chat Header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-secondary)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{avatarEmoji || "robot"}</span>
                <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Test Chat with {name || "Persona"}
                </h3>
              </div>
              <button
                onClick={clearTestChat}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--hover-overlay)]"
                style={{
                  border: "1px solid var(--border-default)",
                  color: "var(--text-muted)",
                }}
              >
                <RotateCcw className="h-3 w-3" />
                Clear Chat
              </button>
            </div>

            {/* Stream Interface */}
            <div className="flex-1 min-h-0">
              <StreamInterface
                workspaceId={workspaceId}
                streamId={testStreamId}
                streamName={`Test: ${name}`}
                title={`Test: ${name}`}
                users={users}
                streams={streams}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center" style={{ background: "var(--bg-tertiary)" }}>
            <div className="text-center p-8 max-w-sm">
              <Bot className="h-16 w-16 mx-auto mb-4 opacity-30" style={{ color: "var(--text-muted)" }} />
              <h3 className="text-lg font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                Test Your Persona
              </h3>
              <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                Configure your persona on the left, then click "Save & Test" to try it out in a live conversation.
              </p>
              <button
                onClick={createTestStream}
                disabled={isCreatingTestStream || !name || !systemPrompt}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2 mx-auto rounded-md text-sm font-medium transition-colors",
                  isCreatingTestStream || !name || !systemPrompt
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:opacity-90",
                )}
                style={{
                  background: "var(--accent-primary)",
                  color: "white",
                }}
              >
                <Play className="h-4 w-4" />
                {isCreatingTestStream ? "Starting..." : "Save & Test"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
