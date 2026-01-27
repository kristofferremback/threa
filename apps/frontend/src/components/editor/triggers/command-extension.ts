import { PluginKey } from "@tiptap/pm/state"
import { createTriggerExtension, type TriggerExtensionOptions } from "./create-trigger-extension"
import type { CommandItem } from "./types"

export const CommandPluginKey = new PluginKey("slashCommand")

export interface CommandNodeAttrs {
  name: string
}

export type CommandOptions = TriggerExtensionOptions<CommandItem>

/**
 * TipTap extension for /slash commands.
 * Creates an inline node that renders as a styled command chip.
 */
export const CommandExtension = createTriggerExtension<CommandItem, CommandNodeAttrs>({
  name: "slashCommand",
  pluginKey: CommandPluginKey,
  char: "/",
  startOfLine: true,
  attributes: {
    name: { dataAttr: "data-name" },
  },
  getClassName: () => "font-mono font-bold bg-muted text-primary text-sm",
  getText: (attrs) => `/${attrs.name}`,
  mapPropsToAttrs: (c) => ({
    name: c.name,
  }),
})
