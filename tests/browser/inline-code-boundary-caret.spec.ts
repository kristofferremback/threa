import { expect, test, type Page } from "@playwright/test"
import { loginAndCreateWorkspace } from "./helpers"

type BoundaryTarget = "outside-start" | "inside-start" | "inside-end" | "outside-end"

interface BoundaryMetrics {
  chars: {
    endHeight: number
    endRight: number
    endTop: number
    startHeight: number
    startLeft: number
    startTop: number
  }
  code: {
    endRight: number
    startLeft: number
  }
  nativeCaretHidden: boolean
  overlay: {
    boundary: string | null
    display: string
    height: number
    left: number
    mode: string | null
    top: number
  } | null
}

async function setComposerContent(page: Page, markdown: string, expectedBlockSelector: string) {
  const editor = page.locator("[contenteditable='true']")

  await editor.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("Backspace")
  await page.keyboard.type(markdown)

  await expect(editor.locator("code")).toHaveText("code")
  await expect(editor.locator(expectedBlockSelector)).toHaveCount(1)
}

async function setInlineCodeBoundaryState(page: Page, target: BoundaryTarget) {
  await page.evaluate((value: BoundaryTarget) => {
    const editorElement = document.querySelector<HTMLElement>("[contenteditable='true']")
    const editor = editorElement?.editor

    if (!editor) {
      throw new Error("Editor not found")
    }

    let codeStart: number | null = null
    let codeEnd: number | null = null

    editor.state.doc.descendants(
      (node: { isText: boolean; marks?: Array<{ type: { name: string } }>; text?: string }, pos: number) => {
        if (!node.isText || !node.text || !node.marks?.some((mark) => mark.type.name === "code")) {
          return
        }

        codeStart = pos
        codeEnd = pos + node.text.length
        return false
      }
    )

    if (codeStart === null || codeEnd === null) {
      throw new Error("Inline code range not found")
    }

    const boundaryPos = value === "outside-start" || value === "inside-start" ? codeStart : codeEnd

    editor.commands.setTextSelection(boundaryPos)

    const nextState = editor.state
    const marks = value === "inside-start" || value === "inside-end" ? [nextState.schema.marks.code.create()] : []
    const tr = nextState.tr.setStoredMarks(marks)

    editor.view.dispatch(tr)
    editor.view.focus()
  }, target)
}

async function getBoundaryMetrics(page: Page): Promise<BoundaryMetrics> {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("[contenteditable='true']")
    const code = editor?.querySelector<HTMLElement>("code")
    const overlay = document.querySelector<HTMLElement>("[data-inline-code-boundary-overlay='true']")

    if (!editor || !code) {
      throw new Error("Editor or inline code not found")
    }

    const textNodes: Text[] = []
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let current: Node | null

    while ((current = walker.nextNode())) {
      if ((current.textContent?.length ?? 0) > 0) {
        textNodes.push(current as Text)
      }
    }

    if (textNodes.length === 0) {
      throw new Error("Inline code text nodes not found")
    }

    const createTextRect = (textNode: Text, edge: "start" | "end") => {
      const range = document.createRange()

      if (edge === "start") {
        range.setStart(textNode, 0)
        range.setEnd(textNode, Math.min(1, textNode.data.length))
      } else {
        range.setStart(textNode, Math.max(0, textNode.data.length - 1))
        range.setEnd(textNode, textNode.data.length)
      }

      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
      return (rects[edge === "start" ? 0 : rects.length - 1] ?? range.getBoundingClientRect()).toJSON()
    }

    const codeRects = Array.from(code.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
    const firstCodeRect = codeRects[0] ?? code.getBoundingClientRect()
    const lastCodeRect = codeRects[codeRects.length - 1] ?? code.getBoundingClientRect()
    const startTextRect = createTextRect(textNodes[0], "start")
    const endTextRect = createTextRect(textNodes[textNodes.length - 1], "end")

    return {
      overlay: overlay
        ? {
            boundary: overlay.dataset.inlineCodeBoundary ?? null,
            mode: overlay.dataset.inlineCodeMode ?? null,
            display: getComputedStyle(overlay).display,
            left: Number.parseFloat(overlay.style.left || "0"),
            top: Number.parseFloat(overlay.style.top || "0"),
            height: Number.parseFloat(overlay.style.height || "0"),
          }
        : null,
      code: {
        startLeft: firstCodeRect.left,
        endRight: lastCodeRect.right,
      },
      chars: {
        startLeft: startTextRect.left,
        startTop: startTextRect.top,
        startHeight: startTextRect.height,
        endRight: endTextRect.right,
        endTop: endTextRect.top,
        endHeight: endTextRect.height,
      },
      nativeCaretHidden: editor.style.caretColor === "transparent",
    }
  })
}

function expectClose(actual: number, expected: number, tolerance = 1.25) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

async function expectBoundaryAlignment(page: Page, target: BoundaryTarget) {
  const metrics = await getBoundaryMetrics(page)
  expect(metrics.overlay).not.toBeNull()
  expect(metrics.nativeCaretHidden).toBe(true)

  const overlay = metrics.overlay!
  expect(overlay.display).toBe("block")

  switch (target) {
    case "outside-start":
      expect(overlay.boundary).toBe("start")
      expect(overlay.mode).toBe("outside")
      expectClose(overlay.left, metrics.code.startLeft)
      expectClose(overlay.top, metrics.chars.startTop)
      expectClose(overlay.height, metrics.chars.startHeight)
      break
    case "inside-start":
      expect(overlay.boundary).toBe("start")
      expect(overlay.mode).toBe("inside")
      expectClose(overlay.left, metrics.chars.startLeft)
      expectClose(overlay.top, metrics.chars.startTop)
      expectClose(overlay.height, metrics.chars.startHeight)
      break
    case "inside-end":
      expect(overlay.boundary).toBe("end")
      expect(overlay.mode).toBe("inside")
      expectClose(overlay.left, metrics.chars.endRight)
      expectClose(overlay.top, metrics.chars.endTop)
      expectClose(overlay.height, metrics.chars.endHeight)
      break
    case "outside-end":
      expect(overlay.boundary).toBe("end")
      expect(overlay.mode).toBe("outside")
      expectClose(overlay.left, metrics.code.endRight)
      expectClose(overlay.top, metrics.chars.endTop)
      expectClose(overlay.height, metrics.chars.endHeight)
      break
  }
}

test.describe("Inline code boundary caret", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndCreateWorkspace(page, "inline-code-caret")
    await page.getByRole("button", { name: "+ New Scratchpad" }).click()
    await expect(page.locator("[contenteditable='true']")).toBeVisible({ timeout: 5000 })
  })

  for (const { blockSelector, label, markdown } of [
    { label: "paragraph", markdown: "a `code` b", blockSelector: "p" },
    { label: "h1", markdown: "# a `code` b", blockSelector: "h1" },
    { label: "h3", markdown: "### a `code` b", blockSelector: "h3" },
  ] as const) {
    test(`aligns the synthetic caret to rendered inline code boundaries in ${label}`, async ({ page }) => {
      await setComposerContent(page, markdown, blockSelector)

      for (const target of ["outside-start", "inside-start", "inside-end", "outside-end"] as const) {
        await setInlineCodeBoundaryState(page, target)
        await expect
          .poll(() =>
            getBoundaryMetrics(page).then((metrics) => `${metrics.overlay?.boundary}:${metrics.overlay?.mode}`)
          )
          .toBe(
            target === "outside-start"
              ? "start:outside"
              : target === "inside-start"
                ? "start:inside"
                : target === "inside-end"
                  ? "end:inside"
                  : "end:outside"
          )
        await expectBoundaryAlignment(page, target)
      }
    })
  }
})
