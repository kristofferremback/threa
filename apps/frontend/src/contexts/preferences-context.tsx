import { createContext, useContext, useEffect, useCallback, useMemo, type ReactNode } from "react"
import { useQueryClient, useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { preferencesApi } from "@/api"
import { useWorkspaceBootstrap, workspaceKeys } from "@/hooks/use-workspaces"
import { applyPreferencesToDOM, getResolvedTheme } from "@/lib/apply-preferences"
import type {
  UserPreferences,
  UpdateUserPreferencesInput,
  AccessibilityPreferences,
  WorkspaceBootstrap,
} from "@threa/types"

const APPEARANCE_STORAGE_KEY = "threa-appearance"

/**
 * Caches appearance-related preferences to localStorage for early application
 * before React mounts. See index.html inline script.
 */
function cacheAppearanceToLocalStorage(prefs: UserPreferences) {
  const appearance = {
    theme: prefs.theme,
    fontSize: prefs.accessibility.fontSize,
    fontFamily: prefs.accessibility.fontFamily,
    reducedMotion: prefs.accessibility.reducedMotion,
    highContrast: prefs.accessibility.highContrast,
    messageDisplay: prefs.messageDisplay,
  }
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance))
}

interface PreferencesContextValue {
  preferences: UserPreferences | null
  resolvedTheme: "light" | "dark"
  isLoading: boolean
  updatePreference: <K extends keyof UpdateUserPreferencesInput>(
    key: K,
    value: UpdateUserPreferencesInput[K]
  ) => Promise<void>
  updateAccessibility: (updates: Partial<AccessibilityPreferences>) => Promise<void>
  updateKeyboardShortcut: (actionId: string, keyBinding: string) => Promise<void>
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

interface PreferencesProviderProps {
  workspaceId: string
  children: ReactNode
}

export function PreferencesProvider({ workspaceId, children }: PreferencesProviderProps) {
  const queryClient = useQueryClient()

  // Subscribe to bootstrap data - this re-renders when socket events update the cache
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const preferences = bootstrap?.userPreferences ?? null

  const resolvedTheme = useMemo(() => {
    if (!preferences) return "light"
    return getResolvedTheme(preferences.theme)
  }, [preferences])

  // Apply preferences to DOM and cache for early application on next load
  useEffect(() => {
    if (!preferences) return
    applyPreferencesToDOM(preferences)
    cacheAppearanceToLocalStorage(preferences)
  }, [preferences])

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (!preferences || preferences.theme !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      applyPreferencesToDOM(preferences)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [preferences])

  // Mutation for updating preferences
  const mutation = useMutation({
    mutationFn: (input: UpdateUserPreferencesInput) => preferencesApi.update(workspaceId, input),
    onMutate: async (input) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })

      // Snapshot the previous value
      const previousBootstrap = queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))

      // Optimistically update to the new value
      if (previousBootstrap?.userPreferences) {
        const newPreferences: UserPreferences = {
          ...previousBootstrap.userPreferences,
          ...input,
          // Handle partial accessibility updates
          accessibility:
            input.accessibility !== undefined
              ? { ...previousBootstrap.userPreferences.accessibility, ...input.accessibility }
              : previousBootstrap.userPreferences.accessibility,
          // Handle keyboard shortcut updates
          keyboardShortcuts:
            input.keyboardShortcuts !== undefined
              ? { ...previousBootstrap.userPreferences.keyboardShortcuts, ...input.keyboardShortcuts }
              : previousBootstrap.userPreferences.keyboardShortcuts,
          updatedAt: new Date().toISOString(),
        }

        queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), {
          ...previousBootstrap,
          userPreferences: newPreferences,
        })
      }

      return { previousBootstrap }
    },
    onError: (_err, _input, context) => {
      // Rollback on error
      if (context?.previousBootstrap) {
        queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), context.previousBootstrap)
      }
      toast.error("Failed to save settings")
    },
    onSuccess: (newPreferences) => {
      // Update cache with server response
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        return { ...old, userPreferences: newPreferences }
      })
      toast.success("Settings saved")
    },
  })

  const updatePreference = useCallback(
    async <K extends keyof UpdateUserPreferencesInput>(key: K, value: UpdateUserPreferencesInput[K]) => {
      await mutation.mutateAsync({ [key]: value } as UpdateUserPreferencesInput)
    },
    [mutation]
  )

  const updateAccessibility = useCallback(
    async (updates: Partial<AccessibilityPreferences>) => {
      await mutation.mutateAsync({ accessibility: updates })
    },
    [mutation]
  )

  const updateKeyboardShortcut = useCallback(
    async (actionId: string, keyBinding: string) => {
      const currentShortcuts = preferences?.keyboardShortcuts ?? {}
      await mutation.mutateAsync({
        keyboardShortcuts: { ...currentShortcuts, [actionId]: keyBinding },
      })
    },
    [mutation, preferences?.keyboardShortcuts]
  )

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      resolvedTheme,
      isLoading: mutation.isPending,
      updatePreference,
      updateAccessibility,
      updateKeyboardShortcut,
    }),
    [preferences, resolvedTheme, mutation.isPending, updatePreference, updateAccessibility, updateKeyboardShortcut]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext)
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider")
  }
  return context
}

/**
 * Hook to get the current theme (for components that need to know the resolved theme)
 */
export function useResolvedTheme(): "light" | "dark" {
  const { resolvedTheme } = usePreferences()
  return resolvedTheme
}
