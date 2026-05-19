import { describe, it, expect } from "vitest"
import { resolve, dirname } from "node:path"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

// The timeline depends on three hand-applied react-virtuoso patches that share
// one regenerated bundle diff, so a future `bun patch` regen or a
// react-virtuoso version bump can silently drop one. These assertions read
// the *installed, patched* bundles (proving the patch actually applied) and
// fail loudly if any defense disappears:
//
//  - PR #521: synchronous scroll-deviation marginTop write (`lR_threa`).
//  - PR #570: the offset/size-tree binary search is made *total* so a search
//    handed an out-of-range index during a mid-rebuild size tree degrades to
//    a clamped best-effort index instead of calling the comparator on an
//    undefined node.
//  - This change: the scrollToIndex *location normalizer* (`Ke`/`De`) is made
//    total. `useVirtuosoScroll` returns `initialTopMostItemIndex: undefined`
//    on deep-link (`?m=`) jumps that skip the initial scroll. Passing the
//    prop as `undefined` is not the same as omitting it: react-virtuoso
//    publishes `undefined` over the index stream's safe numeric default, and
//    a later reactive listState recompute (per-stream Virtuoso remount + no
//    defaultItemHeight => empty size tree) runs the normalizer on `undefined`
//    — `undefined.index` threw "Cannot read properties of undefined (reading
//    'index')", crashing the whole route via the error boundary. The patched
//    normalizer degrades a null/undefined location to index 0 (the stream's
//    own default). stream-content.tsx also no longer passes the prop when it
//    is undefined; this patch is the defense-in-depth backstop.

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

  it("makes the scrollToIndex location normalizer total in the ESM bundle (index.mjs)", () => {
    // The hardened normalizer guards null/undefined before reading `.index`.
    expect(mjs).toContain("if (t == null) return 0;")
    expect(mjs).toMatch(
      /const n = e - 1;\s*\/\* threa patch[\s\S]*?\*\/\s*if \(t == null\) return 0;\s*return typeof t == "number"/
    )
  })

  it("makes the scrollToIndex location normalizer total in the CJS bundle (index.cjs)", () => {
    expect(cjs).toContain("if(t==null)return 0;return typeof")
    // The original, unguarded normalizer must no longer be present.
    expect(cjs).not.toContain(`function De(t,e){const n=e-1;return typeof t=="number"?t:t.index==="LAST"?n:t.index}`)
  })
})
