import { Extension, type Editor } from "@tiptap/react"
import type { Mark as ProseMirrorMark } from "@tiptap/pm/model"
import { TextSelection, type Transaction, Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { MessageSendMode } from "@threa/types"
import { handleEnterTextBehavior, toggleMultilineBlock } from "./multiline-blocks"

export interface EditorBehaviorsOptions {
  /** Ref to current send mode - using ref avoids stale closure in keyboard shortcuts */
  sendModeRef: { current: MessageSendMode }
  /** Ref to submit callback - using ref avoids stale closure in keyboard shortcuts */
  onSubmitRef: { current: () => void }
}

export function indentSelection(editor: Editor): boolean {
  if (editor.isActive("codeBlock")) {
    return handleCodeBlockTab(editor, false)
  }

  if (editor.isActive("listItem")) {
    return editor.chain().focus().sinkListItem("listItem").run()
  }

  return handleTextTab(editor, false)
}

export function dedentSelection(editor: Editor): boolean {
  if (editor.isActive("codeBlock")) {
    return handleCodeBlockTab(editor, true)
  }

  if (editor.isActive("listItem")) {
    return editor.chain().focus().liftListItem("listItem").run()
  }

  return handleTextTab(editor, true)
}

/**
 * Check if any suggestion popup is currently visible with items.
 *
 * Uses editor.storage.popupVisible (set by suggestion hooks) instead of raw
 * plugin state, so that dismissed popups (Escape) and zero-result queries
 * (e.g. `:)`) no longer block Enter from sending.
 */
export function isSuggestionActive(editor: Editor): boolean {
  const s = editor.storage as unknown as Record<string, { popupVisible?: boolean } | undefined>
  return !!(
    s.mention?.popupVisible ||
    s.channelLink?.popupVisible ||
    s.slashCommand?.popupVisible ||
    s.emoji?.popupVisible
  )
}

type EscapableInlineMarkName = "code" | "link"
type BoundaryNavigableInlineMarkName = "code"
type ArrowDirection = "left" | "right"
export type LinkToolbarAction = "opened" | "closed" | "exited"

const codeBoundaryDecorationKey = new PluginKey("codeBoundaryDecoration")

interface CodeBoundaryDecorationState {
  pos: number
  edge: "start" | "end"
  mode: "inside" | "outside"
  side: -1 | 1
}

function getEffectiveCursorMarks(state: EditorState): readonly ProseMirrorMark[] {
  return state.storedMarks ?? state.selection.$from.marks()
}

function findMarkByName(
  marks: readonly ProseMirrorMark[] | null | undefined,
  markName: EscapableInlineMarkName | BoundaryNavigableInlineMarkName
): ProseMirrorMark | undefined {
  return marks?.find((mark) => mark.type.name === markName)
}

function setStoredMarks(editor: Editor, marks: readonly ProseMirrorMark[] | null): boolean {
  const tr = editor.state.tr
  tr.setStoredMarks(marks ? [...marks] : null)
  editor.view.dispatch(tr)
  return true
}

function enterInlineMark(editor: Editor, boundaryMark: ProseMirrorMark): boolean {
  const currentMarks = getEffectiveCursorMarks(editor.state).filter((mark) => mark.type !== boundaryMark.type)
  return setStoredMarks(editor, [...currentMarks, boundaryMark])
}

function getCodeBoundaryDecorationState(state: EditorState): CodeBoundaryDecorationState | null {
  const { selection } = state

  if (!selection.empty) {
    return null
  }

  const { $from, from } = selection
  const beforeCode = findMarkByName($from.nodeBefore?.marks ?? [], "code")
  const afterCode = findMarkByName($from.nodeAfter?.marks ?? [], "code")

  if (!!beforeCode === !!afterCode) {
    return null
  }

  const isInsideCode = !!findMarkByName(getEffectiveCursorMarks(state), "code")

  if (beforeCode) {
    return {
      pos: from,
      edge: "end",
      mode: isInsideCode ? "inside" : "outside",
      side: isInsideCode ? 1 : -1,
    }
  }

  return {
    pos: from,
    edge: "start",
    mode: isInsideCode ? "inside" : "outside",
    side: isInsideCode ? -1 : 1,
  }
}

function createCodeBoundaryWidget(boundary: CodeBoundaryDecorationState) {
  return () => {
    const spacer = document.createElement("span")
    const boundaryWidth = "0.35ch"
    const boundaryOffset = "0.175ch"
    spacer.className = "inline-code-boundary"
    spacer.setAttribute("data-inline-code-boundary", boundary.edge)
    spacer.setAttribute("data-inline-code-mode", boundary.mode)
    spacer.setAttribute("aria-hidden", "true")
    spacer.contentEditable = "false"
    spacer.textContent = "\u200b"
    spacer.style.color = "transparent"
    spacer.style.display = "inline-block"
    spacer.style.fontSize = "inherit"
    spacer.style.lineHeight = "inherit"
    spacer.style.width = boundaryWidth
    spacer.style.marginLeft = `-${boundaryOffset}`
    spacer.style.marginRight = `-${boundaryOffset}`
    spacer.style.pointerEvents = "none"
    spacer.style.userSelect = "none"
    spacer.style.verticalAlign = "baseline"
    return spacer
  }
}

export function exitInlineMark(editor: Editor, markName: EscapableInlineMarkName): boolean {
  const { state } = editor

  if (!state.selection.empty) {
    return false
  }

  const currentMark = findMarkByName(getEffectiveCursorMarks(state), markName)
  if (!currentMark) {
    return false
  }

  const tr = state.tr
  tr.removeStoredMark(currentMark)
  editor.view.dispatch(tr)
  return true
}

export function handleEscapableInlineMarkArrow(editor: Editor, direction: ArrowDirection): boolean {
  const { state } = editor
  const { selection } = state

  if (!selection.empty) {
    return false
  }

  const { $from } = selection
  const beforeMarks = $from.nodeBefore?.marks ?? []
  const afterMarks = $from.nodeAfter?.marks ?? []
  const effectiveMarks = getEffectiveCursorMarks(state)

  for (const markName of ["code"] as const satisfies readonly BoundaryNavigableInlineMarkName[]) {
    const beforeMark = findMarkByName(beforeMarks, markName)
    const afterMark = findMarkByName(afterMarks, markName)
    const isInsideMark = !!findMarkByName(effectiveMarks, markName)

    if (direction === "right") {
      if (beforeMark && !afterMark && isInsideMark) {
        return exitInlineMark(editor, markName)
      }

      if (!beforeMark && afterMark && !isInsideMark) {
        return enterInlineMark(editor, afterMark)
      }
    } else {
      if (beforeMark && !afterMark && !isInsideMark) {
        return enterInlineMark(editor, beforeMark)
      }

      if (!beforeMark && afterMark && isInsideMark) {
        return exitInlineMark(editor, markName)
      }
    }
  }

  return false
}

export function handleLinkToolbarAction(
  editor: Editor,
  linkPopoverOpen: boolean,
  onLinkPopoverOpenChange?: (open: boolean) => void
): LinkToolbarAction {
  if (linkPopoverOpen) {
    onLinkPopoverOpenChange?.(false)
    editor.commands.focus()
    return "closed"
  }

  if (exitInlineMark(editor, "link")) {
    return "exited"
  }

  onLinkPopoverOpenChange?.(true)
  return "opened"
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
 * Keyboard behaviors for the rich text editor:
 * - Formatting shortcuts (Mod-B/I/E/etc) toggle marks
 * - Tab/Shift-Tab indent/dedent (VS Code-like with selection support)
 * - Enter handles list continuation, block exit, and send modes
 * - Shift+Enter has identical text behavior to Enter, but never sends
 */
export const EditorBehaviors = Extension.create<EditorBehaviorsOptions>({
  name: "editorBehaviors",

  // High priority ensures our keyboard shortcuts run before list/block extensions
  priority: 1000,

  addOptions() {
    return {
      sendModeRef: { current: "enter" as MessageSendMode },
      onSubmitRef: { current: () => {} },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBoundaryDecorationKey,
        props: {
          decorations(state) {
            const boundary = getCodeBoundaryDecorationState(state)

            if (!boundary) {
              return null
            }

            return DecorationSet.create(state.doc, [
              Decoration.widget(boundary.pos, createCodeBoundaryWidget(boundary), {
                side: boundary.side,
                key: `inline-code-boundary-${boundary.edge}-${boundary.mode}`,
              }),
            ])
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      // Formatting shortcuts
      "Mod-b": () => this.editor.chain().focus().toggleBold().run(),
      "Mod-i": () => this.editor.chain().focus().toggleItalic().run(),
      "Mod-Shift-s": () => this.editor.chain().focus().toggleStrike().run(),
      "Mod-e": () => this.editor.chain().focus().toggleCode().run(),
      "Mod-Shift-c": () => toggleMultilineBlock(this.editor, "codeBlock"),
      ArrowLeft: () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }

        return handleEscapableInlineMarkArrow(this.editor, "left")
      },
      ArrowRight: () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }

        return handleEscapableInlineMarkArrow(this.editor, "right")
      },

      // Tab: VS Code-style indent (always trapped to prevent focus escape)
      Tab: () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }

        indentSelection(this.editor)
        return true
      },

      // Shift+Tab: VS Code-style dedent (always trapped to prevent focus escape)
      "Shift-Tab": () => {
        dedentSelection(this.editor)
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

      // Enter: in cmdEnter mode, creates newlines (same as Shift+Enter)
      // Note: "enter" send mode is handled in handleKeyDown (rich-editor.tsx) for fresh refs
      Enter: () => {
        if (isSuggestionActive(this.editor)) {
          return false
        }
        // cmdEnter mode: Enter creates newlines
        return handleEnterTextBehavior(this.editor)
      },
    }
  },
})
