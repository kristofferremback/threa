import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { CodeBlockComponent } from "./code-block"

const lowlight = createLowlight(common)

export function createEditorExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
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
    Placeholder.configure({
      placeholder,
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
      lowlight,
      defaultLanguage: "plaintext",
      HTMLAttributes: {
        class: "bg-muted rounded-md p-4 font-mono text-sm overflow-x-auto",
      },
    }),
  ]
}
