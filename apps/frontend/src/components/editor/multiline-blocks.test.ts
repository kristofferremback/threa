import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import type { JSONContent } from "@tiptap/react"
import { createEditorExtensions } from "./editor-extensions"
import { serializeToMarkdown, parseMarkdown } from "./editor-markdown"
import { handleBeforeInputNewline, insertPastedText, toggleMultilineBlock } from "./multiline-blocks"

function createTestEditor(content: string | JSONContent) {
  return new Editor({
    element: document.createElement("div"),
    extensions: createEditorExtensions({ placeholder: "Type a message..." }),
    content:
      typeof content === "string"
        ? parseMarkdown(
            content,
            () => "user",
            () => null
          )
        : content,
  })
}

function createBlockquote(lines: string[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: lines.map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : undefined,
        })),
      },
    ],
  }
}

function createAdjacentCodeBlocks(lines: string[]): JSONContent {
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "codeBlock",
      content: line ? [{ type: "text", text: line }] : undefined,
    })),
  }
}

function createAdjacentBlockquotes(lines: string[]): JSONContent {
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : undefined,
        },
      ],
    })),
  }
}

function findTextPosition(editor: Editor, text: string, occurrence = 1): number {
  let remaining = occurrence
  let found: number | null = null

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true
    }

    const index = node.text.indexOf(text)
    if (index === -1) {
      return true
    }

    remaining -= 1
    if (remaining === 0) {
      found = pos + index
      return false
    }

    return true
  })

  if (found === null) {
    throw new Error(`Could not find text: ${text}`)
  }

  return found
}

function setCursor(editor: Editor, text: string, occurrence = 1) {
  const from = findTextPosition(editor, text, occurrence)
  editor.commands.setTextSelection(from)
}

function selectText(editor: Editor, text: string) {
  const from = findTextPosition(editor, text)
  editor.commands.setTextSelection({ from, to: from + text.length })
}

function selectLines(editor: Editor, startText: string, endText: string) {
  const from = findTextPosition(editor, startText)
  const to = findTextPosition(editor, endText) + endText.length
  editor.commands.setTextSelection({ from, to })
}

function createBeforeInputEvent(inputType: "insertParagraph" | "insertLineBreak" = "insertParagraph") {
  return {
    inputType,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

describe("multiline block toggles", () => {
  it("wraps selected paragraphs in a single code block", () => {
    const editor = createTestEditor("line 1\n\nline 2\n\nline 3")

    selectLines(editor, "line 1", "line 3")
    toggleMultilineBlock(editor, "codeBlock")

    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("line 1\nline 2\nline 3")
    editor.destroy()
  })

  it("wraps selected paragraphs in a single blockquote", () => {
    const editor = createTestEditor("line 1\n\nline 2\n\nline 3")

    selectLines(editor, "line 1", "line 3")
    toggleMultilineBlock(editor, "blockquote")

    const blockquote = editor.state.doc.firstChild

    expect(editor.state.doc.childCount).toBe(1)
    expect(blockquote?.type.name).toBe("blockquote")
    expect(blockquote?.childCount).toBe(3)
    expect(
      Array.from({ length: blockquote?.childCount ?? 0 }, (_, index) => blockquote?.child(index).textContent)
    ).toEqual(["line 1", "line 2", "line 3"])
    editor.destroy()
  })

  it("unwraps only the current code block line when toggled off below the first line", () => {
    const editor = createTestEditor("```\nline 1\nline 2\nline 3\n```")

    setCursor(editor, "line 2")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nline 1\n```\n\nline 2\n\n```\nline 3\n```")
    editor.destroy()
  })

  it("unwraps the full code block when toggled off from the first line", () => {
    const editor = createTestEditor("```\nline 1\nline 2\nline 3\n```")

    setCursor(editor, "line 1")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps the selected code block lines without removing the rest of the block", () => {
    const editor = createTestEditor("```\nline 1\nline 2\nline 3\n```")

    selectLines(editor, "line 2", "line 3")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nline 1\n```\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps selected adjacent code blocks", () => {
    const editor = createTestEditor(createAdjacentCodeBlocks(["line 1", "line 2", "line 3"]))

    selectLines(editor, "line 1", "line 3")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps only the current blockquote line when toggled off below the first line", () => {
    const editor = createTestEditor(createBlockquote(["line 1", "line 2", "line 3"]))

    setCursor(editor, "line 2")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("> line 1\n\nline 2\n\n> line 3")
    editor.destroy()
  })

  it("unwraps the full blockquote when toggled off from the first line", () => {
    const editor = createTestEditor(createBlockquote(["line 1", "line 2", "line 3"]))

    setCursor(editor, "line 1")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps the selected blockquote lines without removing the rest of the quote", () => {
    const editor = createTestEditor(createBlockquote(["line 1", "line 2", "line 3"]))

    selectLines(editor, "line 2", "line 3")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("> line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps selected adjacent blockquotes", () => {
    const editor = createTestEditor(createAdjacentBlockquotes(["line 1", "line 2", "line 3"]))

    selectLines(editor, "line 1", "line 3")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })
})

describe("multiline block paste handling", () => {
  it("keeps pasted multiline text inside a code block", () => {
    const editor = createTestEditor("```\nseed\n```")

    selectText(editor, "seed")
    insertPastedText(
      editor,
      "line 1\nline 2",
      () => "user",
      () => null
    )

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nline 1\nline 2\n```")
    editor.destroy()
  })

  it("keeps pasted multiline text inside a blockquote", () => {
    const editor = createTestEditor(createBlockquote(["seed"]))

    selectText(editor, "seed")
    insertPastedText(
      editor,
      "line 1\nline 2",
      () => "user",
      () => null
    )

    expect(serializeToMarkdown(editor.getJSON())).toBe("> line 1\n> line 2")
    editor.destroy()
  })

  it("inserts a single-line paste inline without splitting the current paragraph", () => {
    const editor = createTestEditor("Hello ")

    editor.commands.setTextSelection(editor.state.doc.content.size)
    insertPastedText(
      editor,
      "World",
      () => "user",
      () => null
    )

    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph")
    expect(serializeToMarkdown(editor.getJSON())).toBe("Hello World")
    editor.destroy()
  })

  it("inserts a single-line paste mid-paragraph without splitting it in two", () => {
    const editor = createTestEditor("Hi my  friend")

    setCursor(editor, " friend")
    insertPastedText(
      editor,
      "little",
      () => "user",
      () => null
    )

    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph")
    expect(serializeToMarkdown(editor.getJSON())).toBe("Hi my little friend")
    editor.destroy()
  })

  it("preserves active marks when pasting plain text inside a styled span", () => {
    const editor = createTestEditor("**bold** text")

    // Place the cursor in the middle of the bold word ("bol|d")
    setCursor(editor, "d")
    insertPastedText(
      editor,
      "X",
      () => "user",
      () => null
    )

    expect(editor.state.doc.childCount).toBe(1)
    expect(serializeToMarkdown(editor.getJSON())).toBe("**bolXd** text")
    editor.destroy()
  })

  it("reconstructs a sharedMessage block when pasted into an empty editor", () => {
    const editor = createTestEditor("")
    editor.commands.setTextSelection(editor.state.doc.content.size)
    insertPastedText(
      editor,
      "Shared a message from [Ariadne](shared-message:stream_01XYZ/msg_01ABC)",
      () => "user",
      () => null
    )

    const json = editor.getJSON()
    const firstBlock = json.content?.[0]
    expect(firstBlock?.type).toBe("sharedMessage")
    expect(firstBlock?.attrs?.messageId).toBe("msg_01ABC")
    expect(firstBlock?.attrs?.streamId).toBe("stream_01XYZ")
    expect(firstBlock?.attrs?.authorName).toBe("Ariadne")
    editor.destroy()
  })

  it("reconstructs a sharedMessage when pasted into a non-empty paragraph", () => {
    const editor = createTestEditor("Hello ")
    editor.commands.setTextSelection(editor.state.doc.content.size)
    insertPastedText(
      editor,
      "Shared a message from [Ariadne](shared-message:stream_01XYZ/msg_01ABC)",
      () => "user",
      () => null
    )

    const blocks = editor.getJSON().content ?? []
    const sharedNode = blocks.find((b) => b.type === "sharedMessage")
    expect(sharedNode).toBeDefined()
    expect(sharedNode?.attrs?.messageId).toBe("msg_01ABC")
    expect(sharedNode?.attrs?.streamId).toBe("stream_01XYZ")
    editor.destroy()
  })

  it("reconstructs a quoteReply block when pasted into an empty editor", () => {
    const editor = createTestEditor("")
    editor.commands.setTextSelection(editor.state.doc.content.size)
    insertPastedText(
      editor,
      "> Hello world\n>\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC/usr_01KR/user)",
      () => "user",
      () => null
    )

    const json = editor.getJSON()
    const firstBlock = json.content?.[0]
    expect(firstBlock?.type).toBe("quoteReply")
    expect(firstBlock?.attrs?.messageId).toBe("msg_01ABC")
    expect(firstBlock?.attrs?.snippet).toBe("Hello world")
    editor.destroy()
  })

  it("reconstructs an attachmentReference when pasted into an empty editor", () => {
    const editor = createTestEditor("")
    editor.commands.setTextSelection(editor.state.doc.content.size)
    insertPastedText(
      editor,
      '[Image #1](attachment:attach_123 "threa-attachment:filename=test.png&mimeType=image%2Fpng&sizeBytes=1024")',
      () => "user",
      () => null
    )

    const json = editor.getJSON()
    const firstBlock = json.content?.[0]
    expect(firstBlock?.type).toBe("paragraph")
    const inlineNode = firstBlock?.content?.[0] as JSONContent | undefined
    expect(inlineNode?.type).toBe("attachmentReference")
    expect(inlineNode?.attrs?.id).toBe("attach_123")
    expect(inlineNode?.attrs?.filename).toBe("test.png")
    expect(inlineNode?.attrs?.mimeType).toBe("image/png")
    expect(inlineNode?.attrs?.sizeBytes).toBe(1024)
    editor.destroy()
  })

  it("keeps multi-line plain-text pastes as separate paragraphs", () => {
    const editor = createTestEditor("prefix ")

    editor.commands.setTextSelection(editor.state.doc.content.size)
    insertPastedText(
      editor,
      "line 1\nline 2",
      () => "user",
      () => null
    )

    expect(serializeToMarkdown(editor.getJSON())).toBe("prefix line 1\n\nline 2")
    editor.destroy()
  })
})

describe("multiline beforeinput enter handling", () => {
  it("exits a code block after a third newline via beforeinput", () => {
    const editor = createTestEditor("```\nconst x = 1\n```")

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

    const firstEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, firstEvent)).toBe(true)
    expect(firstEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("const x = 1\n")

    const secondEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, secondEvent)).toBe(true)
    expect(secondEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("const x = 1\n\n")
    expect(editor.isActive("codeBlock")).toBe(true)

    const thirdEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, thirdEvent)).toBe(true)
    expect(thirdEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("const x = 1")
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph")
    expect(editor.isActive("codeBlock")).toBe(false)
    editor.destroy()
  })

  it("exits a blockquote after a third newline via beforeinput", () => {
    const editor = createTestEditor(createBlockquote(["quoted line"]))

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

    const firstEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, firstEvent)).toBe(true)
    expect(firstEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote")
    expect(editor.state.doc.firstChild?.childCount).toBe(2)

    const secondEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, secondEvent)).toBe(true)
    expect(secondEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote")
    expect(editor.state.doc.firstChild?.childCount).toBe(3)
    expect(editor.isActive("blockquote")).toBe(true)

    const thirdEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, thirdEvent)).toBe(true)
    expect(thirdEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote")
    expect(editor.state.doc.firstChild?.childCount).toBe(2)
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph")
    expect(editor.isActive("blockquote")).toBe(false)
    editor.destroy()
  })
})
