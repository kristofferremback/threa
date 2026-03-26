import type { JSONContent, Editor } from "@tiptap/react"
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model"
import { Selection, type Transaction, type EditorState } from "@tiptap/pm/state"
import { parseMarkdown, type EmojiLookup, type MentionTypeLookup } from "./editor-markdown"

export interface BeforeInputEventLike {
  inputType: string
  preventDefault(): void
}

interface AncestorInfo {
  depth: number
  node: ProseMirrorNode
  pos: number
}

function findAncestor(editor: Editor, nodeName: "codeBlock" | "blockquote"): AncestorInfo | null {
  const { state } = editor
  const { selection } = state
  const selectionEnd = selection.empty ? selection.to : Math.max(selection.to - 1, selection.from)
  const $from = selection.$from
  const $to = state.doc.resolve(selectionEnd)

  let fromInfo: AncestorInfo | null = null
  let toInfo: AncestorInfo | null = null

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === nodeName) {
      fromInfo = {
        depth,
        node: $from.node(depth),
        pos: $from.before(depth),
      }
      break
    }
  }

  for (let depth = $to.depth; depth > 0; depth -= 1) {
    if ($to.node(depth).type.name === nodeName) {
      toInfo = {
        depth,
        node: $to.node(depth),
        pos: $to.before(depth),
      }
      break
    }
  }

  if (!fromInfo || !toInfo) {
    return null
  }

  if (fromInfo.pos !== toInfo.pos || fromInfo.depth !== toInfo.depth) {
    return null
  }

  return fromInfo
}

function createParagraphNode(schema: Schema, text: string): ProseMirrorNode {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
}

function createCodeBlockNode(schema: Schema, attrs: Record<string, unknown>, lines: string[]): ProseMirrorNode {
  const text = lines.join("\n")
  return schema.nodes.codeBlock.create(attrs, text ? schema.text(text) : null)
}

function setSelectionNearInsertedContent(tr: Transaction, nodePos: number, offset: number) {
  const targetPos = Math.min(nodePos + offset, tr.doc.content.size)
  tr.setSelection(Selection.near(tr.doc.resolve(Math.max(1, targetPos)), 1))
}

function getCodeBlockLineRange(text: string, startOffset: number, endOffset: number) {
  const lines = text.split("\n")
  let charCount = 0
  let startLine = 0
  let endLine = 0

  for (let i = 0; i < lines.length; i += 1) {
    const lineEnd = charCount + lines[i].length

    if (startOffset >= charCount && startOffset <= lineEnd) {
      startLine = i
    }

    if (endOffset >= charCount && endOffset <= lineEnd) {
      endLine = i
    }

    charCount = lineEnd + 1
  }

  return { endLine, lines, startLine }
}

function toggleCodeBlockOff(editor: Editor): boolean {
  const ancestor = findAncestor(editor, "codeBlock")
  if (!ancestor) {
    return false
  }

  const { selection, schema } = editor.state
  const contentStart = ancestor.pos + 1
  const startOffset = selection.from - contentStart
  const endOffset = (selection.empty ? selection.from : Math.max(selection.to - 1, selection.from)) - contentStart
  const { lines, startLine, endLine } = getCodeBlockLineRange(ancestor.node.textContent, startOffset, endOffset)
  const removeWholeBlock = selection.empty && startLine === 0

  const beforeLines = removeWholeBlock ? [] : lines.slice(0, startLine)
  const selectedLines = removeWholeBlock ? lines : lines.slice(startLine, endLine + 1)
  const afterLines = removeWholeBlock ? [] : lines.slice(endLine + 1)

  const replacementNodes: ProseMirrorNode[] = []

  if (!removeWholeBlock && beforeLines.length > 0) {
    replacementNodes.push(createCodeBlockNode(schema, ancestor.node.attrs, beforeLines))
  }

  const selectedNodeIndex = replacementNodes.length
  replacementNodes.push(...selectedLines.map((line) => createParagraphNode(schema, line)))

  if (!removeWholeBlock && afterLines.length > 0) {
    replacementNodes.push(createCodeBlockNode(schema, ancestor.node.attrs, afterLines))
  }

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(ancestor.pos, ancestor.pos + ancestor.node.nodeSize, Fragment.fromArray(replacementNodes))

      const leadingSize = replacementNodes.slice(0, selectedNodeIndex).reduce((total, node) => total + node.nodeSize, 0)

      setSelectionNearInsertedContent(tr, ancestor.pos, leadingSize + 1)
      return true
    })
    .run()
}

function getSelectedBlockquoteChildRange(editor: Editor, ancestor: AncestorInfo) {
  const { selection } = editor.state
  const selectionStart = selection.from
  const selectionEnd = selection.empty ? selection.from : Math.max(selection.to - 1, selection.from)
  const children: Array<{ node: ProseMirrorNode; pos: number }> = []
  let startIndex = -1
  let endIndex = -1

  ancestor.node.forEach((child, offset, index) => {
    const pos = ancestor.pos + 1 + offset
    const end = pos + child.nodeSize - 1
    const intersects = selectionStart <= end && selectionEnd >= pos

    children.push({ node: child, pos })

    if (!intersects) {
      return
    }

    if (startIndex === -1) {
      startIndex = index
    }

    endIndex = index
  })

  return { children, endIndex, startIndex }
}

function createBlockquoteNode(
  schema: Schema,
  attrs: Record<string, unknown>,
  children: Array<{ node: ProseMirrorNode }>
): ProseMirrorNode {
  return schema.nodes.blockquote.create(attrs, Fragment.fromArray(children.map((child) => child.node)))
}

function toggleBlockquoteOff(editor: Editor): boolean {
  const ancestor = findAncestor(editor, "blockquote")
  if (!ancestor) {
    return false
  }

  const { selection, schema } = editor.state
  const { children, startIndex, endIndex } = getSelectedBlockquoteChildRange(editor, ancestor)

  if (startIndex === -1 || endIndex === -1) {
    return false
  }

  const removeWholeBlock = selection.empty && startIndex === 0
  const beforeChildren = removeWholeBlock ? [] : children.slice(0, startIndex)
  const selectedChildren = removeWholeBlock ? children : children.slice(startIndex, endIndex + 1)
  const afterChildren = removeWholeBlock ? [] : children.slice(endIndex + 1)

  const replacementNodes: ProseMirrorNode[] = []

  if (!removeWholeBlock && beforeChildren.length > 0) {
    replacementNodes.push(createBlockquoteNode(schema, ancestor.node.attrs, beforeChildren))
  }

  const selectedNodeIndex = replacementNodes.length
  replacementNodes.push(...selectedChildren.map((child) => child.node))

  if (!removeWholeBlock && afterChildren.length > 0) {
    replacementNodes.push(createBlockquoteNode(schema, ancestor.node.attrs, afterChildren))
  }

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(ancestor.pos, ancestor.pos + ancestor.node.nodeSize, Fragment.fromArray(replacementNodes))

      const leadingSize = replacementNodes.slice(0, selectedNodeIndex).reduce((total, node) => total + node.nodeSize, 0)

      setSelectionNearInsertedContent(tr, ancestor.pos, leadingSize + 1)
      return true
    })
    .run()
}

export function toggleMultilineBlock(editor: Editor, nodeName: "codeBlock" | "blockquote"): boolean {
  if (!editor.isActive(nodeName)) {
    if (nodeName === "codeBlock") {
      return editor.chain().focus().toggleCodeBlock().run()
    }

    return editor.chain().focus().toggleBlockquote().run()
  }

  if (nodeName === "codeBlock") {
    return toggleCodeBlockOff(editor)
  }

  return toggleBlockquoteOff(editor)
}

function getParsedContent(
  text: string,
  getMentionType?: MentionTypeLookup,
  getEmoji?: EmojiLookup
): JSONContent[] | undefined {
  return parseMarkdown(text, getMentionType, getEmoji).content
}

export function insertPastedText(
  editor: Editor,
  text: string,
  getMentionType?: MentionTypeLookup,
  getEmoji?: EmojiLookup
): boolean {
  const normalizedText = text.replace(/\r\n?/g, "\n")

  if (editor.isActive("codeBlock")) {
    return editor.chain().focus().insertContent(normalizedText).run()
  }

  if (editor.isActive("blockquote") && normalizedText.includes("\n")) {
    const content = getParsedContent(normalizedText, getMentionType, getEmoji)
    if (!content || content.length === 0) {
      return false
    }

    return editor.chain().focus().insertContent(content).run()
  }

  const parsed = parseMarkdown(normalizedText, getMentionType, getEmoji)
  return editor.commands.insertContent(parsed)
}

/**
 * Handle Enter key press for creating newlines / smart block exits.
 * Shared by keyboard shortcuts and mobile beforeinput handling.
 */
export function handleEnterTextBehavior(editor: Editor): boolean {
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

    return editor.chain().focus().splitListItem("listItem").run()
  }

  // In code blocks: newline on the first enter, exit on the second.
  if (editor.isActive("codeBlock")) {
    const codeBlock = $from.parent
    const text = codeBlock.textContent
    const atEnd = $from.pos === $from.end()

    if (atEnd && text.endsWith("\n")) {
      return editor
        .chain()
        .focus()
        .command(({ tr, state }: { tr: Transaction; state: EditorState }) => {
          const pos = state.selection.$from.pos
          tr.delete(pos - 1, pos)
          return true
        })
        .exitCode()
        .run()
    }

    return editor.chain().focus().insertContent("\n").run()
  }

  // In blockquotes: exit on an empty line.
  if (editor.isActive("blockquote")) {
    const paragraph = $from.parent
    if (paragraph.type.name === "paragraph" && paragraph.content.size === 0) {
      return editor.chain().focus().lift("blockquote").run()
    }
    return editor.chain().focus().splitBlock().run()
  }

  return editor.chain().focus().splitBlock().run()
}

export function handleBeforeInputNewline(editor: Editor, event: BeforeInputEventLike): boolean {
  if (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") {
    return false
  }

  const handled = handleEnterTextBehavior(editor)
  if (handled) {
    event.preventDefault()
  }

  return handled
}
