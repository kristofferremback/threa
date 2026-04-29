import type { JSONContent, Editor } from "@tiptap/react"
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model"
import { Selection, type Transaction, type EditorState } from "@tiptap/pm/state"
import { parseMarkdown, type EmojiLookup, type MentionTypeLookup } from "./editor-markdown"

/**
 * Reverse-engineer text/plain from a paste slice.
 *
 * Android Chrome (and some iOS Safari versions) deliver context-menu
 * pastes through ProseMirror's `paste` event with an empty/restricted
 * `clipboardData`; the only readable copy of the clipboard text is the
 * pre-parsed `slice` ProseMirror passes as the third arg to handlePaste.
 * Without this fallback, none of the markdown-aware conversions on paste
 * — sharedMessage / quoteReply / attachmentReference, plus @mentions,
 * #channels, :emoji: shortcodes — fired on mobile.
 *
 * Joins adjacent textblocks with `\n\n` (the paragraph break used by
 * ProseMirror's text/plain clipboard parser) and renders hardBreaks
 * within a textblock as `\n`, so the recovered string is the same one
 * we'd have read from `getData("text/plain")` on desktop.
 */
export function sliceToText(slice: Slice): string {
  const blocks: string[] = []
  slice.content.forEach((node) => {
    if (!node.isTextblock) {
      // Leaf or other block — fall back to its rendered text content.
      blocks.push(node.textContent)
      return
    }
    let text = ""
    node.forEach((child) => {
      if (child.type.name === "hardBreak") {
        text += "\n"
      } else if (child.isText) {
        text += child.text ?? ""
      } else {
        // Inline atom (mention, emoji, attachment-reference, …) —
        // `textContent` falls back to the node's text representation, which
        // is the schema's `renderText` output where defined.
        text += child.textContent
      }
    })
    blocks.push(text)
  })
  return blocks.join("\n\n")
}

export interface BeforeInputEventLike {
  inputType: string
  /** Set on `insertFromPaste`/`insertReplacementText` `InputEvent`s; carries the paste payload. */
  dataTransfer?: DataTransfer | null
  preventDefault(): void
}

interface AncestorInfo {
  depth: number
  node: ProseMirrorNode
  pos: number
}

interface SelectedBlockInfo {
  index: number
  node: ProseMirrorNode
  pos: number
}

interface SelectedBlockRange {
  blocks: SelectedBlockInfo[]
}

function isEmptyParagraphNode(node: ProseMirrorNode | null | undefined): boolean {
  return !!node && node.type.name === "paragraph" && node.content.size === 0
}

function getSelectedBlockRange(editor: Editor): SelectedBlockRange | null {
  const { state } = editor
  const { selection } = state
  if (selection.empty) {
    return null
  }

  const selectionEnd = Math.max(selection.to - 1, selection.from)
  const $to = state.doc.resolve(selectionEnd)
  const range = selection.$from.blockRange($to)
  if (!range) {
    return null
  }

  const parentPos = range.depth === 0 ? -1 : range.$from.before(range.depth)
  const blocks: SelectedBlockInfo[] = []

  range.parent.forEach((node, offset, index) => {
    if (index < range.startIndex || index >= range.endIndex) {
      return
    }

    blocks.push({
      index,
      node,
      pos: parentPos + 1 + offset,
    })
  })

  return blocks.length > 0 ? { blocks } : null
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

function getFragmentChildren(fragment: Fragment): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    nodes.push(node)
  })
  return nodes
}

function wrapSelectedBlocksInCodeBlock(editor: Editor, blocks: SelectedBlockInfo[]): boolean {
  const { schema } = editor.state
  const firstBlock = blocks[0]
  const lastBlock = blocks[blocks.length - 1]
  const lines = blocks.map((block) => block.node.textContent)
  const codeBlock = createCodeBlockNode(schema, {}, lines)

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(firstBlock.pos, lastBlock.pos + lastBlock.node.nodeSize, codeBlock)
      setSelectionNearInsertedContent(tr, firstBlock.pos, 1)
      return true
    })
    .run()
}

function wrapSelectedBlocksInBlockquote(editor: Editor, blocks: SelectedBlockInfo[]): boolean {
  const { schema } = editor.state
  const firstBlock = blocks[0]
  const lastBlock = blocks[blocks.length - 1]
  const children = blocks.flatMap((block) =>
    block.node.type.name === "blockquote"
      ? getFragmentChildren(block.node.content).map((node) => ({ node }))
      : [{ node: block.node }]
  )
  const blockquote = createBlockquoteNode(schema, {}, children)

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(firstBlock.pos, lastBlock.pos + lastBlock.node.nodeSize, blockquote)
      setSelectionNearInsertedContent(tr, firstBlock.pos, 1)
      return true
    })
    .run()
}

function toggleCodeBlockOffAcrossSelection(editor: Editor, selectedRange: SelectedBlockRange): boolean {
  const { schema } = editor.state
  const { blocks } = selectedRange
  if (!blocks.every((block) => block.node.type.name === "codeBlock") || blocks.length <= 1) {
    return false
  }

  const firstBlock = blocks[0]
  const lastBlock = blocks[blocks.length - 1]
  const replacementNodes = blocks.flatMap((block) =>
    block.node.textContent.split("\n").map((line) => createParagraphNode(schema, line))
  )

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(firstBlock.pos, lastBlock.pos + lastBlock.node.nodeSize, Fragment.fromArray(replacementNodes))
      setSelectionNearInsertedContent(tr, firstBlock.pos, 1)
      return true
    })
    .run()
}

function toggleBlockquoteOffAcrossSelection(editor: Editor, selectedRange: SelectedBlockRange): boolean {
  const { blocks } = selectedRange
  if (!blocks.every((block) => block.node.type.name === "blockquote") || blocks.length <= 1) {
    return false
  }

  const firstBlock = blocks[0]
  const lastBlock = blocks[blocks.length - 1]
  const replacementNodes = blocks.flatMap((block) => getFragmentChildren(block.node.content))

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(firstBlock.pos, lastBlock.pos + lastBlock.node.nodeSize, Fragment.fromArray(replacementNodes))
      setSelectionNearInsertedContent(tr, firstBlock.pos, 1)
      return true
    })
    .run()
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
  const selectedRange = getSelectedBlockRange(editor)

  if (nodeName === "codeBlock" && selectedRange && toggleCodeBlockOffAcrossSelection(editor, selectedRange)) {
    return true
  }

  if (nodeName === "blockquote" && selectedRange && toggleBlockquoteOffAcrossSelection(editor, selectedRange)) {
    return true
  }

  if (!editor.isActive(nodeName)) {
    if (selectedRange && selectedRange.blocks.length > 1) {
      if (nodeName === "codeBlock") {
        return wrapSelectedBlocksInCodeBlock(editor, selectedRange.blocks)
      }

      return wrapSelectedBlocksInBlockquote(editor, selectedRange.blocks)
    }

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
  getEmoji?: EmojiLookup,
  parseOptions?: {
    enableMentions?: boolean
    enableChannels?: boolean
    enableSlashCommands?: boolean
    enableEmoji?: boolean
  }
): JSONContent[] | undefined {
  return parseMarkdown(text, getMentionType, getEmoji, parseOptions).content
}

export function insertPastedText(
  editor: Editor,
  text: string,
  getMentionType?: MentionTypeLookup,
  getEmoji?: EmojiLookup,
  parseOptions?: {
    enableMentions?: boolean
    enableChannels?: boolean
    enableSlashCommands?: boolean
    enableEmoji?: boolean
  }
): boolean {
  const normalizedText = text.replace(/\r\n?/g, "\n")

  if (editor.isActive("codeBlock")) {
    return editor.chain().focus().insertContent(normalizedText).run()
  }

  if (editor.isActive("blockquote") && normalizedText.includes("\n")) {
    const content = getParsedContent(normalizedText, getMentionType, getEmoji, parseOptions)
    if (!content || content.length === 0) {
      return false
    }

    return editor.chain().focus().insertContent(content).run()
  }

  const blocks = getParsedContent(normalizedText, getMentionType, getEmoji, parseOptions)
  if (!blocks || blocks.length === 0) {
    return false
  }

  // When the parsed markdown is a single paragraph (the common case for pasted
  // plain text), unwrap to its inline content. Inserting a paragraph node mid-
  // paragraph makes ProseMirror split the current paragraph, producing stray
  // newlines around the paste. Inserting inline content lets tiptap route plain
  // text through `tr.insertText`, which also preserves the cursor's active
  // marks (bold, inline code, link, ...).
  if (blocks.length === 1 && blocks[0].type === "paragraph") {
    const inline = blocks[0].content
    if (!inline || inline.length === 0) {
      return false
    }
    return editor.commands.insertContent(inline)
  }

  // Multi-paragraph plain-text paste: build a slice open at both ends so the
  // first and last pasted paragraphs merge with the paragraph surrounding the
  // cursor, matching native paste behavior.
  if (blocks.every((block) => block.type === "paragraph")) {
    const { schema } = editor.state
    const fragment = Fragment.fromArray(blocks.map((block) => schema.nodeFromJSON(block)))
    const slice = new Slice(fragment, 1, 1)
    return editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.replaceSelection(slice)
        return true
      })
      .run()
  }

  return editor.commands.insertContent(blocks)
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

  // In code blocks: keep one blank line inside the block, exit on the third newline.
  if (editor.isActive("codeBlock")) {
    const codeBlock = $from.parent
    const text = codeBlock.textContent
    const atEnd = $from.pos === $from.end()
    const trailingNewlineMatch = text.match(/\n+$/u)

    if (atEnd && trailingNewlineMatch && trailingNewlineMatch[0].length >= 2) {
      return editor
        .chain()
        .focus()
        .command(({ tr, state }: { tr: Transaction; state: EditorState }) => {
          const pos = state.selection.$from.pos
          tr.delete(pos - trailingNewlineMatch[0].length, pos)
          return true
        })
        .exitCode()
        .run()
    }

    return editor.chain().focus().insertContent("\n").run()
  }

  // In blockquotes: allow one blank quoted paragraph, then exit on the next empty line.
  if (editor.isActive("blockquote")) {
    const paragraph = $from.parent
    if (isEmptyParagraphNode(paragraph)) {
      const blockquote = findAncestor(editor, "blockquote")
      const childIndex = blockquote ? $from.index(blockquote.depth) : -1
      const previousChild = blockquote && childIndex > 0 ? blockquote.node.child(childIndex - 1) : null

      if (isEmptyParagraphNode(previousChild)) {
        return editor.chain().focus().lift("blockquote").run()
      }
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

/**
 * Catches mobile context-menu / suggestion-bar paste on Android Chrome
 * (and some iOS Safari builds), where the platform routes paste through
 * a `beforeinput` event with `inputType === "insertFromPaste"` instead of
 * (or in addition to) firing a `paste` event with populated `clipboardData`.
 *
 * Without this, the regular `handlePaste` either never runs or sees an
 * empty `clipboardData`, the handler returns false, and the browser's
 * default text insertion drops the raw markdown into the editor — bypassing
 * every markdown-aware conversion (sharedMessage / quoteReply /
 * attachmentReference + @mention / #channel / :emoji:).
 *
 * Reads the paste payload from the InputEvent's `dataTransfer` and routes
 * it through the same `insertPastedText` pipeline as desktop Cmd+V.
 */
export function handleBeforeInputPaste(
  editor: Editor,
  event: BeforeInputEventLike,
  getMentionType?: MentionTypeLookup,
  getEmoji?: EmojiLookup,
  parseOptions?: {
    enableMentions?: boolean
    enableChannels?: boolean
    enableSlashCommands?: boolean
    enableEmoji?: boolean
  }
): boolean {
  if (event.inputType !== "insertFromPaste" && event.inputType !== "insertReplacementText") {
    return false
  }

  const text = event.dataTransfer?.getData("text/plain")
  if (!text) return false

  const handled = insertPastedText(editor, text, getMentionType, getEmoji, parseOptions)
  if (handled) {
    event.preventDefault()
  }
  return handled
}
