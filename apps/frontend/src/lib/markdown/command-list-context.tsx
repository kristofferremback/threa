import { createContext, useContext, useMemo, type ReactNode } from "react"

interface CommandListContextValue {
  isKnownCommand: (name: string) => boolean
}

const CommandListContext = createContext<CommandListContextValue | null>(null)

interface CommandListProviderProps {
  commandNames: readonly string[]
  children: ReactNode
}

/**
 * Provides the set of known slash command names for rendering.
 *
 * Rendered text like "/foo" is only styled as a command chip when `foo` is in
 * this set — matching how mentions, channels, and emojis only render as chips
 * when they resolve to real entities. Without a provider, no text is treated
 * as a command.
 */
export function CommandListProvider({ commandNames, children }: CommandListProviderProps) {
  const value = useMemo<CommandListContextValue>(() => {
    const names = new Set(commandNames.map((n) => n.toLowerCase()))
    return {
      isKnownCommand: (name) => names.has(name.toLowerCase()),
    }
  }, [commandNames])

  return <CommandListContext.Provider value={value}>{children}</CommandListContext.Provider>
}

/**
 * Returns a predicate that reports whether a slash command name is known.
 * Defaults to returning false when no provider is mounted, so untrusted text
 * never renders as a command chip.
 */
export function useIsKnownCommand(): (name: string) => boolean {
  const context = useContext(CommandListContext)
  return context?.isKnownCommand ?? (() => false)
}
