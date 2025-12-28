import { PluginKey } from "@tiptap/pm/state"
import { createTriggerExtension, type TriggerExtensionOptions } from "./create-trigger-extension"
import type { Mentionable } from "./types"

export const MentionPluginKey = new PluginKey("mention")

export interface MentionNodeAttrs {
  id: string
  slug: string
  mentionType: "user" | "persona" | "broadcast" | "me"
}

export type MentionOptions = TriggerExtensionOptions<Mentionable>

const mentionTypeClasses: Record<string, string> = {
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  persona: "bg-primary/10 text-primary",
  broadcast: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  me: "bg-blue-100 text-primary dark:bg-blue-900/50 dark:text-primary",
}

/**
 * TipTap extension for @mentions.
 * Creates an inline node that renders as a styled mention chip.
 */
export const MentionExtension = createTriggerExtension<Mentionable, MentionNodeAttrs>({
  name: "mention",
  pluginKey: MentionPluginKey,
  char: "@",
  attributes: {
    id: { dataAttr: "data-id" },
    slug: { dataAttr: "data-slug" },
    mentionType: { dataAttr: "data-mention-type", default: "user" },
  },
  getClassName: (attrs) => mentionTypeClasses[attrs.mentionType] ?? mentionTypeClasses.user,
  getText: (attrs) => `@${attrs.slug}`,
  mapPropsToAttrs: (m) => ({
    id: m.id,
    slug: m.slug,
    mentionType: m.isCurrentUser ? "me" : m.type,
  }),
})
