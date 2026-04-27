import { describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useRef } from "react"
import { clampTranslate, fitContain, useZoomPan, zoomToPoint, ZOOM_MAX, ZOOM_STEP } from "./use-zoom-pan"

describe("fitContain", () => {
  it("returns zeros for degenerate inputs", () => {
    expect(fitContain(0, 100, 500, 500)).toEqual({ w: 0, h: 0 })
    expect(fitContain(100, 100, 0, 500)).toEqual({ w: 0, h: 0 })
  })

  it("fits by width when image is wider than container aspect", () => {
    // 200x100 image in 500x500 container → width-limited
    expect(fitContain(200, 100, 500, 500)).toEqual({ w: 500, h: 250 })
  })

  it("fits by height when image is taller than container aspect", () => {
    // 100x200 image in 500x500 container → height-limited
    expect(fitContain(100, 200, 500, 500)).toEqual({ w: 250, h: 500 })
  })

  it("returns the container when aspect ratios match exactly", () => {
    expect(fitContain(400, 200, 800, 400)).toEqual({ w: 800, h: 400 })
  })
})

describe("zoomToPoint", () => {
  it("is a no-op when factor is 1", () => {
    const state = { scale: 2, tx: 10, ty: -5 }
    expect(zoomToPoint(state, 2, 50, 50)).toEqual(state)
  })

  it("zoom from identity toward center leaves translate at zero", () => {
    const next = zoomToPoint({ scale: 1, tx: 0, ty: 0 }, 2, 0, 0)
    expect(next).toEqual({ scale: 2, tx: 0, ty: 0 })
  })

  it("zoom toward an offset point shifts translate to keep that point anchored", () => {
    // Start at identity, zoom 1→2 toward point (100, 0) from center.
    // After zoom, the image-local point that was under (100, 0) must still be under (100, 0).
    // Formula: tx' = px*(1-k) + tx*k = 100*(1-2) + 0*2 = -100.
    expect(zoomToPoint({ scale: 1, tx: 0, ty: 0 }, 2, 100, 0)).toEqual({ scale: 2, tx: -100, ty: 0 })
  })

  it("consecutive zoom-to-point calls compose correctly", () => {
    // Zoom 1→2 then 2→4 toward the same point (50, 0) should equal a single 1→4 zoom toward (50, 0).
    const step1 = zoomToPoint({ scale: 1, tx: 0, ty: 0 }, 2, 50, 0)
    const step2 = zoomToPoint(step1, 4, 50, 0)
    const direct = zoomToPoint({ scale: 1, tx: 0, ty: 0 }, 4, 50, 0)
    expect(step2.scale).toBe(direct.scale)
    expect(step2.tx).toBeCloseTo(direct.tx, 6)
    expect(step2.ty).toBeCloseTo(direct.ty, 6)
  })
})

describe("clampTranslate", () => {
  const base = { baseW: 400, baseH: 200, containerW: 400, containerH: 200 }

  it("forces translate to zero when scale is 1 (no overflow)", () => {
    const next = clampTranslate({ scale: 1, tx: 100, ty: 50 }, base.containerW, base.containerH, base.baseW, base.baseH)
    expect(next.tx).toBe(0)
    expect(next.ty).toBe(0)
  })

  it("clamps translate to half the overflow at scale 2", () => {
    // At scale 2, rendered 800x400, container 400x200 → overflow 400x200 → max ±200, ±100.
    const next = clampTranslate(
      { scale: 2, tx: 500, ty: 500 },
      base.containerW,
      base.containerH,
      base.baseW,
      base.baseH
    )
    expect(next.tx).toBe(200)
    expect(next.ty).toBe(100)
  })

  it("clamps negative translate symmetrically", () => {
    const next = clampTranslate(
      { scale: 2, tx: -500, ty: -500 },
      base.containerW,
      base.containerH,
      base.baseW,
      base.baseH
    )
    expect(next.tx).toBe(-200)
    expect(next.ty).toBe(-100)
  })

  it("leaves in-bounds translate unchanged", () => {
    const next = clampTranslate({ scale: 2, tx: 50, ty: -40 }, base.containerW, base.containerH, base.baseW, base.baseH)
    expect(next.tx).toBe(50)
    expect(next.ty).toBe(-40)
  })

  it("preserves scale through clamping", () => {
    const next = clampTranslate({ scale: 3.7, tx: 0, ty: 0 }, base.containerW, base.containerH, base.baseW, base.baseH)
    expect(next.scale).toBe(3.7)
  })
})

/**
 * Wires up the hook with a real container div + img, mocked to a known size so
 * the zoom math operates on stable bounds. jsdom does not lay out, so we have
 * to spoof clientWidth/Height and naturalWidth/Height directly.
 */
function renderZoomPanHarness(opts?: { onZoomChange?: (z: boolean) => void; onScaleChange?: (s: number) => void }) {
  const container = document.createElement("div")
  const img = document.createElement("img")
  Object.defineProperty(container, "clientWidth", { value: 400, configurable: true })
  Object.defineProperty(container, "clientHeight", { value: 200, configurable: true })
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true })
  Object.defineProperty(img, "naturalHeight", { value: 400, configurable: true })
  Object.defineProperty(img, "complete", { value: true, configurable: true })
  document.body.appendChild(container)
  container.appendChild(img)

  const result = renderHook(() => {
    const containerRef = useRef<HTMLDivElement | null>(container)
    const contentRef = useRef<HTMLImageElement | null>(img)
    return useZoomPan({ containerRef, contentRef, ...opts })
  })

  return {
    ...result,
    img,
    container,
    cleanup: () => {
      container.remove()
    },
  }
}

describe("useZoomPan (integration)", () => {
  it("starts unzoomed and applies identity transform", () => {
    const harness = renderZoomPanHarness()
    expect(harness.result.current.isZoomed).toBe(false)
    // Transform may be empty before any commit fires; either way it's effectively identity.
    expect(harness.img.style.transform === "" || harness.img.style.transform.includes("scale(1)")).toBe(true)
    harness.cleanup()
  })

  it("zoomIn flips isZoomed and writes a scaled transform onto the image", () => {
    const onZoomChange = vi.fn()
    const harness = renderZoomPanHarness({ onZoomChange })

    act(() => harness.result.current.zoomIn())

    expect(harness.result.current.isZoomed).toBe(true)
    expect(onZoomChange).toHaveBeenCalledWith(true)
    expect(harness.img.style.transform).toContain(`scale(${ZOOM_STEP})`)
    harness.cleanup()
  })

  it("publishes scale synchronously to onScaleChange (no React state hop)", () => {
    const onScaleChange = vi.fn()
    const harness = renderZoomPanHarness({ onScaleChange })

    act(() => harness.result.current.zoomIn())

    expect(onScaleChange).toHaveBeenCalledWith(ZOOM_STEP)
    harness.cleanup()
  })

  it("reset returns to identity and re-fires onZoomChange(false)", () => {
    const onZoomChange = vi.fn()
    const harness = renderZoomPanHarness({ onZoomChange })

    act(() => harness.result.current.zoomIn())
    onZoomChange.mockClear()
    act(() => harness.result.current.reset())

    expect(harness.result.current.isZoomed).toBe(false)
    expect(onZoomChange).toHaveBeenCalledWith(false)
    expect(harness.img.style.transform).toContain("scale(1)")
    harness.cleanup()
  })

  it("zoomOut from identity is a no-op (clamped at ZOOM_MIN)", () => {
    const onScaleChange = vi.fn()
    const harness = renderZoomPanHarness({ onScaleChange })

    act(() => harness.result.current.zoomOut())

    expect(harness.result.current.isZoomed).toBe(false)
    expect(onScaleChange).not.toHaveBeenCalled()
    harness.cleanup()
  })

  it("repeated zoomIn caps at ZOOM_MAX", () => {
    const onScaleChange = vi.fn()
    const harness = renderZoomPanHarness({ onScaleChange })

    // ZOOM_STEP=1.5, ZOOM_MAX=8 → ceil(log_1.5(8)) = 6 steps suffices.
    for (let i = 0; i < 10; i++) act(() => harness.result.current.zoomIn())

    const lastScale = onScaleChange.mock.calls.at(-1)?.[0]
    expect(lastScale).toBe(ZOOM_MAX)
    harness.cleanup()
  })
})
