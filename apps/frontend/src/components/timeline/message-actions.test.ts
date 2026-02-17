import { describe, it, expect, vi } from "vitest"
import { getVisibleActions, messageActions, type MessageActionContext } from "./message-actions"

function createContext(overrides: Partial<MessageActionContext> = {}): MessageActionContext {
  return {
    contentMarkdown: "# Hello\n\nThis is **bold** and `code`.",
    actorType: "member",
    replyUrl: "/panel/draft:stream_1:msg_1",
    ...overrides,
  }
}

describe("getVisibleActions", () => {
  it("should return reply-in-thread and copy for user messages", () => {
    const actions = getVisibleActions(createContext())
    const ids = actions.map((a) => a.id)

    expect(ids).toEqual(["reply-in-thread", "copy"])
  })

  it("should include show-trace for persona messages with sessionId and traceUrl", () => {
    const actions = getVisibleActions(
      createContext({
        actorType: "persona",
        sessionId: "session_123",
        traceUrl: "/trace/session_123",
      })
    )
    const ids = actions.map((a) => a.id)

    expect(ids).toEqual(["show-trace", "reply-in-thread", "copy"])
  })

  it("should not include show-trace for persona messages without sessionId", () => {
    const actions = getVisibleActions(createContext({ actorType: "persona", traceUrl: "/trace/x" }))
    const ids = actions.map((a) => a.id)

    expect(ids).not.toContain("show-trace")
  })

  it("should not include show-trace for persona messages without traceUrl", () => {
    const actions = getVisibleActions(createContext({ actorType: "persona", sessionId: "session_123" }))
    const ids = actions.map((a) => a.id)

    expect(ids).not.toContain("show-trace")
  })

  it("should not include show-trace for member messages", () => {
    const actions = getVisibleActions(createContext({ sessionId: "session_123", traceUrl: "/trace/x" }))
    const ids = actions.map((a) => a.id)

    expect(ids).not.toContain("show-trace")
  })

  it("should not include reply-in-thread when viewing as thread parent", () => {
    const actions = getVisibleActions(createContext({ isThreadParent: true }))
    const ids = actions.map((a) => a.id)

    expect(ids).not.toContain("reply-in-thread")
    expect(ids).toEqual(["copy"])
  })
})

describe("message action behaviors", () => {
  it("show-trace should return traceUrl from getHref", () => {
    const ctx = createContext({
      actorType: "persona",
      sessionId: "session_123",
      traceUrl: "/trace/session_123",
    })

    const traceAction = messageActions.find((a) => a.id === "show-trace")!

    expect(traceAction.getHref!(ctx)).toBe("/trace/session_123")
  })

  it("reply-in-thread should return replyUrl from getHref", () => {
    const ctx = createContext({ replyUrl: "/panel/thread_456" })

    const replyAction = messageActions.find((a) => a.id === "reply-in-thread")!

    expect(replyAction.getHref!(ctx)).toBe("/panel/thread_456")
  })

  it("copy should have markdown and plain text sub-actions", () => {
    const copyAction = messageActions.find((a) => a.id === "copy")!

    expect(copyAction.subActions).toHaveLength(2)
    expect(copyAction.subActions![0].id).toBe("copy-markdown")
    expect(copyAction.subActions![1].id).toBe("copy-plain-text")
  })

  it("copy-markdown should write markdown to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const copyAction = messageActions.find((a) => a.id === "copy")!
    const markdownSub = copyAction.subActions!.find((a) => a.id === "copy-markdown")!

    await markdownSub.action!(createContext({ contentMarkdown: "# Title\n\n**bold** text" }))

    expect(writeText).toHaveBeenCalledWith("# Title\n\n**bold** text")
  })

  it("copy-plain-text should strip markdown before copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const copyAction = messageActions.find((a) => a.id === "copy")!
    const plainSub = copyAction.subActions!.find((a) => a.id === "copy-plain-text")!

    await plainSub.action!(createContext({ contentMarkdown: "# Title\n\n**bold** and `code`" }))

    expect(writeText).toHaveBeenCalledWith("Title\n\nbold and code")
  })
})
