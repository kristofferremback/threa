import { Extension, type Editor } from "@tiptap/react"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"

/**
 * Calculate how many characters were removed from a line when dedenting
 */
function getRemoved(original: string, modified: string): number {
  return original.length - modified.length
}

/**
 * Dedent a single line - remove leading tab or up to 2 spaces
 */
function dedentLine(line: string): string {
  if (line.startsWith("\t")) {
    return line.slice(1)
  }
  const match = line.match(/^( {1,2})/)
  if (match) {
    return line.slice(match[1].length)
  }
  return line
}

/**
 * Handle tab/shift-tab in code blocks with VS Code-like behavior:
 * - No selection: Tab inserts tab, Shift+Tab dedents current line
 * - With selection: Tab/Shift+Tab indents/dedents all affected lines
 */
function handleCodeBlockTab(editor: Editor, dedent: boolean): boolean {
  const { state } = editor
  const { selection } = state
  const { from, to, empty } = selection

  // Get the code block node and its position
  const $from = selection.$from
  const codeBlockDepth = $from.depth
  const codeBlockStart = $from.start(codeBlockDepth)
  const codeBlockEnd = $from.end(codeBlockDepth)
  const codeBlock = $from.parent
  const text = codeBlock.textContent

  // Calculate offsets within the code block text
  const startOffset = from - codeBlockStart
  const endOffset = to - codeBlockStart

  // Find which lines are affected and their positions
  const originalLines = text.split("\n")
  const lines = [...originalLines]
  let charCount = 0
  let startLine = 0
  let endLine = 0
  const lineStarts: number[] = []

  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(charCount)
    const lineEnd = charCount + lines[i].length

    if (startOffset >= charCount && startOffset <= lineEnd) {
      startLine = i
    }
    if (endOffset >= charCount && endOffset <= lineEnd) {
      endLine = i
    }
    charCount = lineEnd + 1 // +1 for newline
  }

  // Track total changes for selection end adjustment
  let totalDelta = 0

  if (empty) {
    if (dedent) {
      const original = lines[startLine]
      lines[startLine] = dedentLine(original)
      if (lines[startLine] === original) {
        return true // Nothing to dedent
      }
      totalDelta = -(original.length - lines[startLine].length)
    } else {
      // Insert tab at cursor position
      return editor.chain().focus().insertContent("\t").run()
    }
  } else {
    // With selection - modify all affected lines
    for (let i = startLine; i <= endLine; i++) {
      const original = lines[i]
      if (dedent) {
        lines[i] = dedentLine(original)
        const removed = getRemoved(original, lines[i])
        totalDelta -= removed
      } else {
        // Add tab to non-empty lines
        if (original.length > 0) {
          lines[i] = "\t" + original
          totalDelta += 1
        }
      }
    }
  }

  const newText = lines.join("\n")

  // Calculate the start of the first affected line (for selection)
  const firstLineStart = codeBlockStart + lineStarts[startLine]

  // Replace code block content and restore selection
  return editor
    .chain()
    .focus()
    .command(({ tr, state }: { tr: Transaction; state: EditorState }) => {
      const schema = state.schema

      // Create new code block with updated text
      const newCodeBlock = schema.nodes.codeBlock.create(codeBlock.attrs, newText ? schema.text(newText) : null)

      // Replace the code block content
      tr.replaceWith(codeBlockStart - 1, codeBlockEnd + 1, newCodeBlock)

      // Restore selection:
      // - For empty selection (cursor only), adjust cursor position
      // - For range selection, start from beginning of first line to include indent
      if (empty) {
        const newPos = Math.max(codeBlockStart, from + totalDelta)
        tr.setSelection(TextSelection.create(tr.doc, newPos))
      } else {
        const newFrom = firstLineStart
        const newTo = Math.max(newFrom, to + totalDelta)
        tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo))
      }

      return true
    })
    .run()
}

/**
 * Handle tab/shift-tab in regular text (paragraphs, headings, etc.)
 * - No selection: Tab inserts tab, Shift+Tab dedents current line
 * - With selection: Tab/Shift+Tab indents/dedents all affected blocks
 */
function handleTextTab(editor: Editor, dedent: boolean): boolean {
  const { state } = editor
  const { selection } = state
  const { from, to, empty } = selection
  const $from = selection.$from

  if (empty) {
    // No selection - work with current text block
    const textBlock = $from.parent
    if (!textBlock.isTextblock) {
      return false
    }

    const blockStart = $from.start()
    const text = textBlock.textContent

    if (dedent) {
      // Dedent current block - remove leading whitespace
      const newText = dedentLine(text)
      if (newText === text) {
        return true // Nothing to dedent
      }
      const removed = text.length - newText.length

      return editor
        .chain()
        .focus()
        .command(({ tr }: { tr: Transaction }) => {
          // Delete the leading whitespace
          tr.delete(blockStart, blockStart + removed)
          // Adjust cursor position
          const newPos = Math.max(blockStart, from - removed)
          tr.setSelection(TextSelection.create(tr.doc, newPos))
          return true
        })
        .run()
    } else {
      // Insert tab at cursor
      return editor.chain().focus().insertContent("\t").run()
    }
  }

  // With selection - handle all blocks in the selection range
  return editor
    .chain()
    .focus()
    .command(({ tr, state: cmdState }: { tr: Transaction; state: EditorState }) => {
      const { doc } = cmdState

      // Collect all text blocks in selection with their positions
      const blocks: { start: number; text: string }[] = []
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock) {
          const start = pos + 1 // +1 to get inside the node content
          blocks.push({ start, text: node.textContent })
        }
      })

      if (blocks.length === 0) {
        return true
      }

      // Remember first block start for selection (before any modifications)
      const firstBlockStart = blocks[0].start

      // Track cumulative position changes for selection adjustment
      let totalDelta = 0

      // Process in reverse order to maintain positions
      for (let i = blocks.length - 1; i >= 0; i--) {
        const { start, text: blockText } = blocks[i]

        if (dedent) {
          const newText = dedentLine(blockText)
          if (newText !== blockText) {
            const removed = blockText.length - newText.length
            tr.delete(start, start + removed)
            totalDelta -= removed
          }
        } else {
          // Only indent non-empty blocks (or single block selection)
          if (blockText.length > 0 || blocks.length === 1) {
            tr.insertText("\t", start)
            totalDelta += 1
          }
        }
      }

      // Restore selection:
      // - Start from beginning of first block (to include added indent)
      // - End adjusted by total changes
      const newFrom = firstBlockStart
      const newTo = Math.max(newFrom, to + totalDelta)
      tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo))

      return true
    })
    .run()
}

/**
 * Custom keyboard behaviors for the editor:
 * - Tab/Shift+Tab for indent/dedent (VS Code-like behavior)
 * - Smart list exit on empty item
 * - Smart code block exit on double empty line
 */
export const EditorBehaviors = Extension.create({
  name: "editorBehaviors",

  addKeyboardShortcuts() {
    return {
      // Tab for indent - always handle to prevent browser focus change
      Tab: () => {
        if (this.editor.isActive("codeBlock")) {
          return handleCodeBlockTab(this.editor, false)
        }
        // In lists, use Tiptap's list commands
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().sinkListItem("listItem").run()
        }
        // Regular text - handle tab with selection support
        // Always return true to prevent browser default (focus change)
        handleTextTab(this.editor, false)
        return true
      },

      // Shift+Tab for dedent - always handle to prevent browser focus change
      "Shift-Tab": () => {
        if (this.editor.isActive("codeBlock")) {
          return handleCodeBlockTab(this.editor, true)
        }
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().liftListItem("listItem").run()
        }
        // Regular text - handle dedent
        // Always return true to prevent browser default (focus change)
        handleTextTab(this.editor, true)
        return true
      },

      // Cmd/Ctrl+A: select all within code block if inside one
      "Mod-a": () => {
        if (this.editor.isActive("codeBlock")) {
          const { selection } = this.editor.state
          const $from = selection.$from
          const codeBlockStart = $from.start($from.depth)
          const codeBlockEnd = $from.end($from.depth)

          // Only intercept if not already selecting the whole code block
          const alreadySelectingAll = selection.from === codeBlockStart && selection.to === codeBlockEnd

          if (!alreadySelectingAll) {
            this.editor.chain().focus().setTextSelection({ from: codeBlockStart, to: codeBlockEnd }).run()
            return true
          }
        }
        // Let default select-all happen
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
