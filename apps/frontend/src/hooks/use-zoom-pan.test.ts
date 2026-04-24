import { describe, it, expect } from "vitest"
import { clampTranslate, fitContain, zoomToPoint } from "./use-zoom-pan"

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
    const next = zoomToPoint({ scale: 1, tx: 0, ty: 0 }, 2, 100, 0)
    expect(next.scale).toBe(2)
    expect(next.tx).toBe(-100)
    expect(next.ty).toBe(0)
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
