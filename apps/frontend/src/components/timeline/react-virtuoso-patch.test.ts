import { describe, it, expect } from "vitest"
import { resolve, dirname } from "node:path"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

// The timeline depends on two hand-applied react-virtuoso patches that share
// one regenerated bundle diff, so a future `bun patch` regen or a
// react-virtuoso version bump can silently drop one. These assertions read
// the *installed, patched* bundles (proving the patch actually applied) and
// fail loudly if either defense disappears:
//
//  - PR #521: synchronous scroll-deviation marginTop write (`lR_threa`).
//  - This change: the offset/size-tree binary search is made *total*. While
//    the size tree is mid-rebuild (per-stream Virtuoso remount + no
//    defaultItemHeight + a deep-link scrollToIndex while data length shifts
//    under jump-window swaps / infinite-scroll prepends) the search was
//    handed an index outside the tree's dense range and called the
//    comparator on an undefined node — "Cannot read properties of undefined
//    (reading 'index')" — crashing the whole route via the error boundary.
//    The patched search degrades to a clamped best-effort index.

const require = createRequire(import.meta.url)
const distDir = dirname(require.resolve("react-virtuoso"))
const mjs = readFileSync(resolve(distDir, "index.mjs"), "utf8")
const cjs = readFileSync(resolve(distDir, "index.cjs"), "utf8")

describe("react-virtuoso patch is applied", () => {
  it("keeps the PR #521 synchronous deviation write", () => {
    expect(mjs).toContain("lR_threa")
    expect(cjs).toContain("lR_threa")
  })

  it("makes the binary search total in the ESM bundle (index.mjs)", () => {
    expect(mjs).toContain("if (i === void 0)")
    expect(mjs).toContain("return Math.max(0, s - 1)")
    expect(mjs).toContain("return Math.max(0, Math.min(t.length - 1, r))")
    // The original, unhardened search must no longer be present.
    expect(mjs).not.toContain("const s = Math.floor((o + r) / 2), i = t[s], l = n(i, e);")
  })

  it("makes the binary search total in the CJS bundle (index.cjs)", () => {
    expect(cjs).toContain("if(i===void 0)return Math.min(s,r)")
    expect(cjs).toContain("return Math.max(0,Math.min(t.length-1,r))}")
    expect(cjs).not.toContain("const s=Math.floor((o+r)/2),i=t[s],l=n(i,e);")
  })
})
