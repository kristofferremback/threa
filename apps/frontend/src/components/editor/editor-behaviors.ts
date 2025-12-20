import { Extension } from "@tiptap/react"

/**
 * Custom keyboard behaviors for the editor:
 * - Tab inserts tab character (doesn't change focus)
 * - Smart list exit on empty item
 * - Smart code block exit on double empty line
 */
export const EditorBehaviors = Extension.create({
  name: "editorBehaviors",

  addKeyboardShortcuts() {
    return {
      // Tab inserts tab character instead of changing focus
      Tab: () => {
        if (this.editor.isActive("codeBlock")) {
          return this.editor.chain().focus().insertContent("\t").run()
        }
        // In lists, indent
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().sinkListItem("listItem").run()
        }
        // Default: insert tab
        return this.editor.chain().focus().insertContent("\t").run()
      },

      // Shift+Tab for outdent in lists
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().liftListItem("listItem").run()
        }
        return false
      },

      // Shift+Enter: always insert soft line break within the block
      "Shift-Enter": () => {
        // In code blocks, insert actual newline character (not hardBreak)
        if (this.editor.isActive("codeBlock")) {
          return this.editor.chain().focus().insertContent("\n").run()
        }
        // Elsewhere, insert hardBreak node
        return this.editor.chain().focus().setHardBreak().run()
      },

      // Enter key handling for smart behaviors
      Enter: () => {
        // In lists: exit on empty item
        if (this.editor.isActive("listItem")) {
          const { $from } = this.editor.state.selection
          const listItem = $from.node($from.depth - 1)

          // Check if current list item is empty (only has empty paragraph)
          if (listItem?.type.name === "listItem") {
            const isEmpty =
              listItem.childCount === 1 &&
              listItem.firstChild?.type.name === "paragraph" &&
              listItem.firstChild.content.size === 0

            if (isEmpty) {
              // Exit the list
              return this.editor.chain().focus().liftListItem("listItem").run()
            }
          }
        }

        // In blockquotes: exit on empty line
        if (this.editor.isActive("blockquote")) {
          const { $from } = this.editor.state.selection
          const paragraph = $from.parent

          if (paragraph.type.name === "paragraph" && paragraph.content.size === 0) {
            // Exit blockquote
            return this.editor.chain().focus().lift("blockquote").run()
          }
        }

        // In code blocks: exit on double empty line at end
        if (this.editor.isActive("codeBlock")) {
          const { $from } = this.editor.state.selection
          const codeBlock = $from.parent
          const text = codeBlock.textContent
          const atEnd = $from.pos === $from.end()

          // Check if we're at the end and text ends with double newline
          if (atEnd && text.endsWith("\n\n")) {
            // Remove trailing newlines and exit
            return this.editor
              .chain()
              .focus()
              .command(
                ({
                  tr,
                  state,
                }: {
                  tr: { delete: (from: number, to: number) => void }
                  state: { selection: { $from: { pos: number } } }
                }) => {
                  const pos = state.selection.$from.pos
                  tr.delete(pos - 2, pos)
                  return true
                }
              )
              .exitCode()
              .run()
          }
        }

        // Default: let Tiptap handle it
        return false
      },
    }
  },
})
