import { type AnyExtension } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { CodeBlockComponent } from "./code-block"
import { MentionExtension, type MentionOptions } from "./triggers/mention-extension"
import { ChannelExtension, type ChannelOptions } from "./triggers/channel-extension"
import { CommandExtension, type CommandOptions } from "./triggers/command-extension"
import { AtomAwareBold, AtomAwareItalic, AtomAwareStrike, AtomAwareCode } from "./atom-aware-marks"

// Lazy singleton - created on first editor mount, not at module load
let lowlightInstance: ReturnType<typeof createLowlight> | null = null
function getLowlight() {
  if (!lowlightInstance) {
    lowlightInstance = createLowlight(common)
  }
  return lowlightInstance
}

interface CreateEditorExtensionsOptions {
  placeholder: string
  mentionSuggestion?: MentionOptions["suggestion"]
  channelSuggestion?: ChannelOptions["suggestion"]
  commandSuggestion?: CommandOptions["suggestion"]
}

export function createEditorExtensions(options: CreateEditorExtensionsOptions | string) {
  // Support legacy string-only signature
  const config: CreateEditorExtensionsOptions = typeof options === "string" ? { placeholder: options } : options

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      // Disable default mark extensions - we use atom-aware versions instead
      // that correctly handle mentions and other atom nodes
      bold: false,
      italic: false,
      strike: false,
      code: false,
      blockquote: {
        HTMLAttributes: {
          class: "border-l-2 border-primary/50 pl-4 my-2 text-muted-foreground italic",
        },
      },
      bulletList: {
        HTMLAttributes: {
          class: "list-disc pl-6 my-2",
        },
      },
      orderedList: {
        HTMLAttributes: {
          class: "list-decimal pl-6 my-2",
        },
      },
      listItem: {
        HTMLAttributes: {
          class: "mb-1",
        },
      },
      horizontalRule: {
        HTMLAttributes: {
          class: "my-4 border-border",
        },
      },
      dropcursor: false,
      gapcursor: false,
    }),
    // Atom-aware mark extensions that handle mentions correctly
    AtomAwareBold,
    AtomAwareItalic,
    AtomAwareStrike,
    AtomAwareCode,
    Placeholder.configure({
      placeholder: config.placeholder,
      emptyEditorClass: "is-editor-empty",
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        class: "text-primary underline underline-offset-2 hover:text-primary/80",
      },
    }),
    CodeBlockLowlight.extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockComponent)
      },
    }).configure({
      lowlight: getLowlight(),
      defaultLanguage: "plaintext",
      HTMLAttributes: {
        class: "bg-muted rounded-md p-4 font-mono text-sm overflow-x-auto",
      },
    }),
  ]

  // Add mention extension if suggestion config provided
  if (config.mentionSuggestion) {
    extensions.push(
      MentionExtension.configure({
        suggestion: config.mentionSuggestion,
      })
    )
  }

  // Add channel extension if suggestion config provided
  if (config.channelSuggestion) {
    extensions.push(
      ChannelExtension.configure({
        suggestion: config.channelSuggestion,
      })
    )
  }

  // Add command extension if suggestion config provided
  if (config.commandSuggestion) {
    extensions.push(
      CommandExtension.configure({
        suggestion: config.commandSuggestion,
      })
    )
  }

  return extensions
}
