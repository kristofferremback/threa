import { describe, it, expect } from "bun:test"
import { EXCEL_MAX_ROWS_PER_REQUEST } from "../../attachments"
import { createLoadExcelSectionTool } from "./load-excel-section-tool"
import type { WorkspaceToolDeps } from "./tool-deps"

function makeDeps(): WorkspaceToolDeps {
  return {
    db: {} as WorkspaceToolDeps["db"],
    workspaceId: "workspace_test",
    accessibleStreamIds: ["stream_1"],
    invokingUserId: "usr_test",
    searchService: {} as WorkspaceToolDeps["searchService"],
    storage: {} as WorkspaceToolDeps["storage"],
    attachmentService: {} as WorkspaceToolDeps["attachmentService"],
    memoExplorer: {} as WorkspaceToolDeps["memoExplorer"],
  }
}

describe("load_excel_section schema", () => {
  const schema = createLoadExcelSectionTool(makeDeps()).config.inputSchema

  it("rejects a row range exceeding the per-request maximum with a message stating the limit", () => {
    const result = schema.safeParse({
      attachmentId: "attach_1",
      sheetName: "Sheet1",
      startRow: 0,
      endRow: EXCEL_MAX_ROWS_PER_REQUEST + 1,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["endRow"],
        message: `Cannot load more than ${EXCEL_MAX_ROWS_PER_REQUEST} rows at once`,
      })
    )
  })

  it("accepts a row range at the per-request maximum", () => {
    const result = schema.safeParse({
      attachmentId: "attach_1",
      sheetName: "Sheet1",
      startRow: 0,
      endRow: EXCEL_MAX_ROWS_PER_REQUEST,
    })

    expect(result.success).toBe(true)
  })
})
