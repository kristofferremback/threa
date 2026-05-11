import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { useMessageMarkdownCopy } from "./use-message-markdown-copy"
import { renderHook, act } from "@testing-library/react"

function dispatchCopy(target: HTMLElement): {
  data: Map<string, string>
  preventedDefault: boolean
} {
  const data = new Map<string, string>()
  let preventedDefault = false
  const event = new Event("copy", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (mime: string, value: string) => {
        data.set(mime, value)
      },
      getData: (mime: string) => data.get(mime) ?? "",
    },
  })
  const originalPreventDefault = event.preventDefault.bind(event)
  event.preventDefault = () => {
    preventedDefault = true
    originalPreventDefault()
  }
  target.dispatchEvent(event)
  return { data, preventedDefault }
}

function selectAll(node: Node): void {
  const selection = window.getSelection()
  if (!selection) throw new Error("no selection")
  selection.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(node)
  selection.addRange(range)
}

describe("useMessageMarkdownCopy", () => {
  let body: HTMLDivElement

  beforeEach(() => {
    body = document.createElement("div")
    body.textContent = "Hello world"
    document.body.appendChild(body)
  })

  afterEach(() => {
    body.remove()
    window.getSelection()?.removeAllRanges()
  })

  it("writes contentMarkdown when the entire message body is selected", () => {
    const markdown = "Hello [world](quote:str_1/msg_1/usr_1/user)"
    const { result } = renderHook(() => useMessageMarkdownCopy(markdown))
    act(() => {
      result.current(body)
    })

    selectAll(body)
    const { data, preventedDefault } = dispatchCopy(body)

    expect(preventedDefault).toBe(true)
    expect(data.get("text/plain")).toBe(markdown)
  })

  it("falls through to default behavior when only a partial selection is made", () => {
    const markdown = "Hello [world](quote:str_1/msg_1/usr_1/user)"
    const { result } = renderHook(() => useMessageMarkdownCopy(markdown))
    act(() => {
      result.current(body)
    })

    const selection = window.getSelection()!
    selection.removeAllRanges()
    const range = document.createRange()
    const textNode = body.firstChild!
    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)
    selection.addRange(range)

    const { data, preventedDefault } = dispatchCopy(body)

    expect(preventedDefault).toBe(false)
    expect(data.get("text/plain")).toBeUndefined()
  })

  it("ignores selections outside the message body", () => {
    const outside = document.createElement("p")
    outside.textContent = "elsewhere"
    document.body.appendChild(outside)

    const markdown = "Hello world"
    const { result } = renderHook(() => useMessageMarkdownCopy(markdown))
    act(() => {
      result.current(body)
    })

    selectAll(outside)
    const { data, preventedDefault } = dispatchCopy(body)

    expect(preventedDefault).toBe(false)
    expect(data.get("text/plain")).toBeUndefined()

    outside.remove()
  })
})
