import { describe, it, expect } from "vitest"
import { buildRevisionList } from "./message-history-dialog"
import type { MessageVersion } from "@threa/types"

function createVersion(overrides: Partial<MessageVersion> = {}): MessageVersion {
  return {
    id: "msgv_1",
    messageId: "msg_1",
    versionNumber: 1,
    contentJson: { type: "doc", content: [] },
    contentMarkdown: "version content",
    editedBy: "member_1",
    createdAt: "2026-02-17T10:00:00Z",
    ...overrides,
  }
}

describe("buildRevisionList", () => {
  it("should place current version first with isCurrent flag", () => {
    const revisions = buildRevisionList([], { contentMarkdown: "current content", editedAt: "2026-02-17T12:00:00Z" })

    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({
      revisionNumber: 1,
      isCurrent: true,
      contentMarkdown: "current content",
      timestamp: "2026-02-17T12:00:00Z",
    })
  })

  it("should number current revision as versions.length + 1", () => {
    const versions = [createVersion({ versionNumber: 1 }), createVersion({ id: "msgv_2", versionNumber: 2 })]

    const revisions = buildRevisionList(versions, { contentMarkdown: "current" })

    expect(revisions[0].revisionNumber).toBe(3)
    expect(revisions[0].isCurrent).toBe(true)
  })

  it("should use version numbers as revision numbers for previous versions", () => {
    const versions = [createVersion({ versionNumber: 1, contentMarkdown: "original" })]

    const revisions = buildRevisionList(versions, { contentMarkdown: "current" })

    expect(revisions).toHaveLength(2)
    expect(revisions[1].revisionNumber).toBe(1)
    expect(revisions[1].isCurrent).toBe(false)
    expect(revisions[1].contentMarkdown).toBe("original")
  })

  it("should sort previous versions in descending order (newest first)", () => {
    const versions = [
      createVersion({ versionNumber: 1, contentMarkdown: "first" }),
      createVersion({ id: "msgv_2", versionNumber: 2, contentMarkdown: "second" }),
      createVersion({ id: "msgv_3", versionNumber: 3, contentMarkdown: "third" }),
    ]

    const revisions = buildRevisionList(versions, { contentMarkdown: "current" })

    expect(revisions.map((r) => r.revisionNumber)).toEqual([4, 3, 2, 1])
    expect(revisions.every((r, i) => r.isCurrent === (i === 0))).toBe(true)
  })

  it("should not have isCurrent on previous versions", () => {
    const versions = [createVersion()]

    const revisions = buildRevisionList(versions, { contentMarkdown: "current" })

    expect(revisions[1].isCurrent).toBe(false)
  })
})
