import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "./editor-extensions"
import type { ContextRefChipAttrs } from "./context-ref-chip-extension"

function createEditor(): Editor {
  const element = document.createElement("div")
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: createEditorExtensions({ placeholder: "Type a message..." }),
  })
  editor.on("destroy", () => element.remove())
  return editor
}

function readyAttrs(overrides: Partial<ContextRefChipAttrs> = {}): ContextRefChipAttrs {
  return {
    refKind: "thread",
    streamId: "stream_src",
    fromMessageId: null,
    toMessageId: null,
    label: "Thread from #intro",
    status: "ready",
    fingerprint: "fp_1",
    errorMessage: null,
    ...overrides,
  }
}

describe("ContextRefChipExtension", () => {
  it("inserts a chip node with the provided attrs", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs())
    const json = editor.getJSON()
    const para = json.content?.[0]
    const chip = para?.content?.find((n) => n.type === "contextRefChip") as
      | { type: string; attrs: Record<string, unknown> }
      | undefined
    expect(chip).toBeDefined()
    expect(chip?.attrs).toMatchObject({
      refKind: "thread",
      streamId: "stream_src",
      label: "Thread from #intro",
      status: "ready",
      fingerprint: "fp_1",
    })
    editor.destroy()
  })

  it("inserts a trailing space after the chip so the caret lands beyond it", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs())
    const content = editor.getJSON().content?.[0]?.content
    expect(content?.at(-1)).toEqual(expect.objectContaining({ type: "text", text: " " }))
    editor.destroy()
  })

  it("flips status to ready and writes the fingerprint via updateContextRefChip", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs({ status: "pending", fingerprint: null, label: "Thread" }))

    const updated = editor.commands.updateContextRefChip(
      { refKind: "thread", streamId: "stream_src", fromMessageId: null, toMessageId: null },
      { status: "ready", fingerprint: "fp_2" }
    )
    expect(updated).toBe(true)

    const chip = editor.getJSON().content?.[0]?.content?.find((n) => n.type === "contextRefChip") as
      | { type: string; attrs: Record<string, unknown> }
      | undefined
    expect(chip?.attrs).toMatchObject({ status: "ready", fingerprint: "fp_2" })
    editor.destroy()
  })

  it("updateContextRefChip returns false when no chip matches the identity tuple", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs())
    const updated = editor.commands.updateContextRefChip(
      { refKind: "thread", streamId: "stream_other", fromMessageId: null, toMessageId: null },
      { status: "ready" }
    )
    expect(updated).toBe(false)
    editor.destroy()
  })

  it("matches chips including anchor tuple (streamId alone is not sufficient)", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs({ fromMessageId: "msg_a", toMessageId: null, status: "pending" }))

    // Different fromMessageId — should not match.
    const wrongAnchor = editor.commands.updateContextRefChip(
      { refKind: "thread", streamId: "stream_src", fromMessageId: "msg_b", toMessageId: null },
      { status: "ready" }
    )
    expect(wrongAnchor).toBe(false)

    // Exact anchor — should match.
    const rightAnchor = editor.commands.updateContextRefChip(
      { refKind: "thread", streamId: "stream_src", fromMessageId: "msg_a", toMessageId: null },
      { status: "ready" }
    )
    expect(rightAnchor).toBe(true)
    editor.destroy()
  })

  it("serializes the chip to renderable HTML attributes for IDB round-trip", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs({ fromMessageId: "msg_a" }))
    const html = editor.getHTML()
    expect(html).toContain('data-type="context-ref-chip"')
    expect(html).toContain('data-ref-kind="thread"')
    expect(html).toContain('data-stream-id="stream_src"')
    expect(html).toContain('data-from-message-id="msg_a"')
    expect(html).toContain('data-label="Thread from #intro"')
    expect(html).toContain('data-status="ready"')
    expect(html).toContain('data-fingerprint="fp_1"')
    editor.destroy()
  })

  it("round-trips a chip through HTML parse so IDB-restored drafts keep their attrs", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs({ status: "pending", fingerprint: null }))
    const html = editor.getHTML()

    const editor2 = createEditor()
    editor2.commands.setContent(html, { parseOptions: { preserveWhitespace: "full" } })
    const chip = editor2.getJSON().content?.[0]?.content?.find((n) => n.type === "contextRefChip") as
      | { type: string; attrs: Record<string, unknown> }
      | undefined
    expect(chip?.attrs).toMatchObject({
      refKind: "thread",
      streamId: "stream_src",
      label: "Thread from #intro",
      status: "pending",
      fingerprint: null,
    })
    editor.destroy()
    editor2.destroy()
  })

  it("renderText uses the chip label for copy-paste out of the editor", () => {
    const editor = createEditor()
    editor.commands.insertContextRefChip(readyAttrs({ label: "Thread from #intro" }))
    expect(editor.getText()).toContain("[Thread from #intro]")
    editor.destroy()
  })
})
