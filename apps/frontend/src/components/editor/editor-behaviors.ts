import { Extension, type Editor } from "@tiptap/react"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"
import { MentionPluginKey } from "./triggers/mention-extension"
import { ChannelPluginKey } from "./triggers/channel-extension"
import { CommandPluginKey } from "./triggers/command-extension"
import { EmojiPluginKey } from "./triggers/emoji-extension"
import type { MessageSendMode } from "@threa/types"

export interface EditorBehaviorsOptions {
  sendMode: MessageSendMode
  onSubmit: () => void
}

/**
 * Check if any suggestion popup is currently active.
 * When a suggestion is active, we should not handle Tab ourselves.
 */
function isSuggestionActive(editor: Editor): boolean {
  const { state } = editor
  const mentionState = MentionPluginKey.getState(state)
  const channelState = ChannelPluginKey.getState(state)
  const commandState = CommandPluginKey.getState(state)
  const emojiState = EmojiPluginKey.getState(state)

  // The suggestion plugin stores state when active (has query, range, etc.)
  return !!(mentionState?.active || channelState?.active || commandState?.active || emojiState?.active)
}

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
 * Handle block creation: lists, blockquotes, code blocks, default paragraphs.
 * Returns true if handled, false to let TipTap handle it.
 */
function handleBlockCreation(editor: Editor): boolean {
  // In lists: exit on empty item, otherwise create new item
  if (editor.isActive("listItem")) {
    const { $from } = editor.state.selection
    const listItem = $from.node($from.depth - 1)

    if (listItem?.type.name === "listItem") {
      const isEmpty =
        listItem.childCount === 1 &&
        listItem.firstChild?.type.name === "paragraph" &&
        listItem.firstChild.content.size === 0

      if (isEmpty) {
        return editor.chain().focus().liftListItem("listItem").run()
      }
    }
  }

  // In blockquotes: exit on empty line
  if (editor.isActive("blockquote")) {
    const { $from } = editor.state.selection
    const paragraph = $from.parent

    if (paragraph.type.name === "paragraph" && paragraph.content.size === 0) {
      return editor.chain().focus().lift("blockquote").run()
    }
  }

  // In code blocks: exit on double empty line at end
  if (editor.isActive("codeBlock")) {
    const { $from } = editor.state.selection
    const codeBlock = $from.parent
    const text = codeBlock.textContent
    const atEnd = $from.pos === $from.end()

    if (atEnd && text.endsWith("\n\n")) {
      return editor
        .chain()
        .focus()
        .command(({ tr, state }: { tr: Transaction; state: EditorState }) => {
          const pos = state.selection.$from.pos
          tr.delete(pos - 2, pos)
          return true
        })
        .exitCode()
        .run()
    }

    // Otherwise, just insert newline in code block
    return editor.chain().focus().insertContent("\n").run()
  }

  // Default: let TipTap handle it (creates new paragraph)
  return false
}

/**
 * Check if we're in a context that requires block creation instead of sending.
 * Used in "enter" mode to determine if Enter should create a block or send.
 */
function shouldCreateBlockInsteadOfSend(editor: Editor): boolean {
  // Lists: always handle via block creation (exit on empty, new item otherwise)
  if (editor.isActive("listItem")) {
    return true
  }

  // Blockquotes: always handle via block creation (exit on empty line)
  if (editor.isActive("blockquote")) {
    return true
  }

  // Code blocks: always handle via block creation (has its own exit mechanism)
  if (editor.isActive("codeBlock")) {
    return true
  }

  return false
}

/**
 * Custom keyboard behaviors for the editor:
 * - Tab/Shift+Tab for indent/dedent (VS Code-like behavior)
 * - Smart list exit on empty item
 * - Smart code block exit on double empty line
 * - Configurable send behavior (Enter vs Cmd+Enter)
 */
export const EditorBehaviors = Extension.create<EditorBehaviorsOptions>({
  name: "editorBehaviors",

  addOptions() {
    return {
      sendMode: "cmdEnter" as MessageSendMode,
      onSubmit: () => {},
    }
  },

  addKeyboardShortcuts() {
    const { sendMode, onSubmit } = this.options

    return {
      // Tab for indent - handle unless a suggestion popup is active
      Tab: () => {
        // If a suggestion popup is active, let the suggestion plugin handle Tab
        if (isSuggestionActive(this.editor)) {
          return false
        }

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

      // Cmd/Ctrl+Enter: send in cmdEnter mode, no-op in enter mode
      "Mod-Enter": () => {
        if (sendMode === "cmdEnter") {
          onSubmit()
          return true
        }
        return false
      },

      // Shift+Enter behavior depends on mode
      "Shift-Enter": () => {
        if (sendMode === "enter") {
          // In "enter" mode, Shift+Enter does what Enter normally does (create blocks)
          return handleBlockCreation(this.editor)
        }

        // In "cmdEnter" mode, insert soft break
        if (this.editor.isActive("codeBlock")) {
          return this.editor.chain().focus().insertContent("\n").run()
        }
        return this.editor.chain().focus().setHardBreak().run()
      },

      // Enter key behavior depends on mode
      Enter: () => {
        if (sendMode === "enter") {
          // In "enter" mode, check if we should create a block instead of send
          if (shouldCreateBlockInsteadOfSend(this.editor)) {
            return handleBlockCreation(this.editor)
          }
          // Otherwise, send the message
          onSubmit()
          return true
        }

        // In "cmdEnter" mode, Enter creates blocks (original behavior)
        return handleBlockCreation(this.editor)
      },
    }
  },
})
