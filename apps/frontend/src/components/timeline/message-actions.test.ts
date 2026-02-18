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

  describe("edit action visibility", () => {
    it("should show edit action when author matches current member", () => {
      const actions = getVisibleActions(createContext({ authorId: "member_1", currentMemberId: "member_1" }))

      expect(actions.find((a) => a.id === "edit-message")).toBeDefined()
    })

    it("should not show edit action when author differs from current member", () => {
      const actions = getVisibleActions(createContext({ authorId: "member_1", currentMemberId: "member_2" }))

      expect(actions.find((a) => a.id === "edit-message")).toBeUndefined()
    })

    it("should not show edit action for persona messages", () => {
      const actions = getVisibleActions(
        createContext({ actorType: "persona", authorId: "persona_1", currentMemberId: "member_1" })
      )

      expect(actions.find((a) => a.id === "edit-message")).toBeUndefined()
    })

    it("should not show edit action when authorId is missing", () => {
      const actions = getVisibleActions(createContext({ currentMemberId: "member_1" }))

      expect(actions.find((a) => a.id === "edit-message")).toBeUndefined()
    })
  })

  describe("delete action visibility", () => {
    it("should show delete action when author matches current member", () => {
      const actions = getVisibleActions(createContext({ authorId: "member_1", currentMemberId: "member_1" }))

      const deleteAction = actions.find((a) => a.id === "delete-message")
      expect(deleteAction).toBeDefined()
      expect(deleteAction!.variant).toBe("destructive")
    })

    it("should not show delete action when author differs from current member", () => {
      const actions = getVisibleActions(createContext({ authorId: "member_1", currentMemberId: "member_2" }))

      expect(actions.find((a) => a.id === "delete-message")).toBeUndefined()
    })

    it("should not show delete action for persona messages", () => {
      const actions = getVisibleActions(
        createContext({ actorType: "persona", authorId: "persona_1", currentMemberId: "member_1" })
      )

      expect(actions.find((a) => a.id === "delete-message")).toBeUndefined()
    })
  })

  describe("action ordering for own messages", () => {
    it("should place edit before copy and delete after copy", () => {
      const actions = getVisibleActions(createContext({ authorId: "member_1", currentMemberId: "member_1" }))

      const ids = actions.map((a) => a.id)
      const editIdx = ids.indexOf("edit-message")
      const copyIdx = ids.indexOf("copy")
      const deleteIdx = ids.indexOf("delete-message")

      expect(editIdx).toBeLessThan(copyIdx)
      expect(deleteIdx).toBeGreaterThan(copyIdx)
    })
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

  it("edit action should invoke onEdit callback", () => {
    const onEdit = vi.fn()
    const ctx = createContext({
      authorId: "member_1",
      currentMemberId: "member_1",
      onEdit,
    })

    const editAction = getVisibleActions(ctx).find((a) => a.id === "edit-message")!
    editAction.action!(ctx)

    expect(onEdit).toHaveBeenCalledOnce()
  })

  it("delete action should invoke onDelete callback", () => {
    const onDelete = vi.fn()
    const ctx = createContext({
      authorId: "member_1",
      currentMemberId: "member_1",
      onDelete,
    })

    const deleteAction = getVisibleActions(ctx).find((a) => a.id === "delete-message")!
    deleteAction.action!(ctx)

    expect(onDelete).toHaveBeenCalledOnce()
  })
})
