import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), "index.css")
const css = readFileSync(cssPath, "utf8")

describe("index.css accessibility font families", () => {
  it("applies selected font family to the body when data-font-family is set on root", () => {
    expect(css).toMatch(/\[data-font-family="system"] body/)
    expect(css).toMatch(/\[data-font-family="monospace"] body/)
    expect(css).toMatch(/\[data-font-family="dyslexic"] body/)
  })

  it("keeps the app default font stack for the system accessibility option", () => {
    expect(css).toMatch(/\[data-font-family="system"],\s*\[data-font-family="system"] body\s*{[\s\S]*"Space Grotesk"/)
  })
})

describe("index.css mobile inline-edit composer hiding", () => {
  // This CSS rule replaces a ref-counted React context that was prone to leaks
  // (PRs #299 and #306 patched specific paths, but leakage kept recurring on
  // refresh). Keep it — deleting the rule re-opens the class of bugs where the
  // mobile stream composer stays invisible after the edit surface is gone.
  it("hides the mobile stream composer while any inline edit surface is in the DOM", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*639px\)\s*{[\s\S]*body:has\(\[data-inline-edit\]\)\s*\[data-message-composer-root\]\s*{[\s\S]*display:\s*none/
    )
  })
})
