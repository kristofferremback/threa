import { Extension, type Editor } from "@tiptap/react"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"
import type { MessageSendMode } from "@threa/types"
import { MentionPluginKey } from "./triggers/mention-extension"
import { ChannelPluginKey } from "./triggers/channel-extension"
import { CommandPluginKey } from "./triggers/command-extension"
import { EmojiPluginKey } from "./triggers/emoji-extension"

export interface EditorBehaviorsOptions {
  /** Ref to current send mode - using ref avoids stale closure in keyboard shortcuts */
  sendModeRef: { current: MessageSendMode }
  /** Ref to submit callback - using ref avoids stale closure in keyboard shortcuts */
  onSubmitRef: { current: () => void }
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

  return !!(mentionState?.active || channelState?.active || commandState?.active || emojiState?.active)
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

  const $from = selection.$from
  const codeBlockDepth = $from.depth
  const codeBlockStart = $from.start(codeBlockDepth)
  const codeBlockEnd = $from.end(codeBlockDepth)
  const codeBlock = $from.parent
  const text = codeBlock.textContent

  const startOffset = from - codeBlockStart
  const endOffset = to - codeBlockStart

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
    charCount = lineEnd + 1
  }

  let totalDelta = 0

  if (empty) {
    if (dedent) {
      const original = lines[startLine]
      lines[startLine] = dedentLine(original)
      if (lines[startLine] === original) {
        return true
      }
      totalDelta = -(original.length - lines[startLine].length)
    } else {
      return editor.chain().focus().insertContent("\t").run()
    }
  } else {
    for (let i = startLine; i <= endLine; i++) {
      const original = lines[i]
      if (dedent) {
        lines[i] = dedentLine(original)
        const removed = original.length - lines[i].length
        totalDelta -= removed
      } else {
        if (original.length > 0) {
          lines[i] = "\t" + original
          totalDelta += 1
        }
      }
    }
  }

  const newText = lines.join("\n")
  const firstLineStart = codeBlockStart + lineStarts[startLine]

  return editor
    .chain()
    .focus()
    .command(({ tr, state: cmdState }: { tr: Transaction; state: EditorState }) => {
      const schema = cmdState.schema
      const newCodeBlock = schema.nodes.codeBlock.create(codeBlock.attrs, newText ? schema.text(newText) : null)

      tr.replaceWith(codeBlockStart - 1, codeBlockEnd + 1, newCodeBlock)

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
    const textBlock = $from.parent
    if (!textBlock.isTextblock) {
      return false
    }

    const blockStart = $from.start()
    const text = textBlock.textContent

    if (dedent) {
      const newText = dedentLine(text)
      if (newText === text) {
        return true
      }
      const removed = text.length - newText.length

      return editor
        .chain()
        .focus()
        .command(({ tr }: { tr: Transaction }) => {
          tr.delete(blockStart, blockStart + removed)
          const newPos = Math.max(blockStart, from - removed)
          tr.setSelection(TextSelection.create(tr.doc, newPos))
          return true
        })
        .run()
    } else {
      return editor.chain().focus().insertContent("\t").run()
    }
  }

  return editor
    .chain()
    .focus()
    .command(({ tr, state: cmdState }: { tr: Transaction; state: EditorState }) => {
      const { doc } = cmdState

      const blocks: { start: number; text: string }[] = []
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock) {
          const start = pos + 1
          blocks.push({ start, text: node.textContent })
        }
      })

      if (blocks.length === 0) {
        return true
      }

      const firstBlockStart = blocks[0].start
      let totalDelta = 0

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
          if (blockText.length > 0 || blocks.length === 1) {
            tr.insertText("\t", start)
            totalDelta += 1
          }
        }
      }

      const newFrom = firstBlockStart
      const newTo = Math.max(newFrom, to + totalDelta)
      tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo))

      return true
    })
    .run()
}

/**
 * Handle Enter key press for creating newlines / smart block exits.
 * This is the shared text manipulation behavior for both Enter and Shift+Enter.
 * Returns true if handled, false to let default behavior proceed.
 */
function handleEnterTextBehavior(editor: Editor): boolean {
  const { $from } = editor.state.selection

  // Check for ``` code block trigger
  if ($from.parent.isTextblock && !editor.isActive("codeBlock")) {
    const lineText = $from.parent.textContent
    const match = lineText.match(/^```(\w*)$/)
    if (match) {
      const language = match[1] || "plaintext"
      const start = $from.start()
      const end = $from.end()
      return editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.delete(start, end)
          return true
        })
        .setCodeBlock({ language })
        .run()
    }
  }

  // In lists: exit on empty item, otherwise split to create new item
  if (editor.isActive("listItem")) {
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
    // Split list item to create new one (same as Enter default)
    return editor.chain().focus().splitListItem("listItem").run()
  }

  // In blockquotes: exit on empty line
  if (editor.isActive("blockquote")) {
    const paragraph = $from.parent
    if (paragraph.type.name === "paragraph" && paragraph.content.size === 0) {
      return editor.chain().focus().lift("blockquote").run()
    }
    return false
  }

  // In code blocks: exit on double empty line at end
  if (editor.isActive("codeBlock")) {
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
    return false // Let default code block behavior handle
  }

  // Regular text: create new paragraph
  return editor.chain().focus().splitBlock().run()
}

/**
 * Keyboard behaviors for the rich text editor:
 * - Formatting shortcuts (Mod-B/I/E/etc) toggle marks
 * - Tab/Shift-Tab indent/dedent (VS Code-like with selection support)
 * - Enter handles list continuation, block exit, and send modes
 * - Shift+Enter has identical text behavior to Enter, but never sends
 */
export const EditorBehaviors = Extension.create<EditorBehaviorsOptions>({
  name: "editorBehaviors",

  addOptions() {
    return {
      sendModeRef: { current: "enter" as MessageSendMode },
      onSubmitRef: { current: () => {} },
    }
  },

  addKeyboardShortcuts() {
    return {
      // Formatting shortcuts
      "Mod-b": () => this.editor.chain().focus().toggleBold().run(),
      "Mod-i": () => this.editor.chain().focus().toggleItalic().run(),
      "Mod-Shift-s": () => this.editor.chain().focus().toggleStrike().run(),
      "Mod-e": () => this.editor.chain().focus().toggleCode().run(),
      "Mod-Shift-c": () => this.editor.chain().focus().toggleCodeBlock().run(),

      // Tab: VS Code-style indent
      Tab: () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }

        if (this.editor.isActive("codeBlock")) {
          return handleCodeBlockTab(this.editor, false)
        }
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().sinkListItem("listItem").run()
        }
        handleTextTab(this.editor, false)
        return true
      },

      // Shift+Tab: VS Code-style dedent
      "Shift-Tab": () => {
        if (this.editor.isActive("codeBlock")) {
          return handleCodeBlockTab(this.editor, true)
        }
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().liftListItem("listItem").run()
        }
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

          const alreadySelectingAll = selection.from === codeBlockStart && selection.to === codeBlockEnd

          if (!alreadySelectingAll) {
            this.editor.chain().focus().setTextSelection({ from: codeBlockStart, to: codeBlockEnd }).run()
            return true
          }
        }
        return false
      },

      // Cmd/Ctrl+Enter: always send
      "Mod-Enter": () => {
        this.options.onSubmitRef.current()
        return true
      },

      // Shift+Enter: same text behavior as Enter, but never sends
      "Shift-Enter": () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }
        return handleEnterTextBehavior(this.editor)
      },

      // Enter: text behavior + send mode logic
      Enter: () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }

        // In "enter" send mode, Enter sends the message (unless in a block that needs continuation)
        if (this.options.sendModeRef.current === "enter") {
          // Check if we're in a context where Enter should create newlines, not send
          const isInCodeBlock = this.editor.isActive("codeBlock")
          const isInList = this.editor.isActive("listItem")
          const isInBlockquote = this.editor.isActive("blockquote")

          // For lists: only send if on empty item (which would exit the list)
          if (isInList) {
            const { $from } = this.editor.state.selection
            const listItem = $from.node($from.depth - 1)
            if (listItem?.type.name === "listItem") {
              const isEmpty =
                listItem.childCount === 1 &&
                listItem.firstChild?.type.name === "paragraph" &&
                listItem.firstChild.content.size === 0

              if (isEmpty) {
                // Exit list then send
                this.editor.chain().focus().liftListItem("listItem").run()
                this.options.onSubmitRef.current()
                return true
              }
              // Continue list (add new item)
              return false
            }
          }

          // For blockquotes: only send if on empty line (which would exit)
          if (isInBlockquote) {
            const { $from } = this.editor.state.selection
            if ($from.parent.content.size === 0) {
              this.editor.chain().focus().lift("blockquote").run()
              this.options.onSubmitRef.current()
              return true
            }
            return false
          }

          // For code blocks: continue in code block (newlines needed for code)
          if (isInCodeBlock) {
            // Check for exit condition (double empty line at end)
            const { $from } = this.editor.state.selection
            const text = $from.parent.textContent
            const atEnd = $from.pos === $from.end()

            if (atEnd && text.endsWith("\n\n")) {
              // Exit code block then send
              this.editor
                .chain()
                .focus()
                .command(({ tr, state }) => {
                  const pos = state.selection.$from.pos
                  tr.delete(pos - 2, pos)
                  return true
                })
                .exitCode()
                .run()
              this.options.onSubmitRef.current()
              return true
            }
            return false // Insert newline in code block
          }

          // Check for ``` code block trigger before sending
          const { $from } = this.editor.state.selection
          if ($from.parent.isTextblock) {
            const lineText = $from.parent.textContent
            const match = lineText.match(/^```(\w*)$/)
            if (match) {
              const language = match[1] || "plaintext"
              const start = $from.start()
              const end = $from.end()
              return this.editor
                .chain()
                .focus()
                .command(({ tr }) => {
                  tr.delete(start, end)
                  return true
                })
                .setCodeBlock({ language })
                .run()
            }
          }

          // Regular text: send the message
          this.options.onSubmitRef.current()
          return true
        }

        // cmdEnter mode: Enter creates newlines (same as Shift+Enter)
        return handleEnterTextBehavior(this.editor)
      },
    }
  },
})
