import { createHighlighter, type HighlighterGeneric } from "shiki"

/**
 * Languages we pre-load at app start so the first paint of any code block
 * in a chat message is already highlighted. Covers what people actually paste
 * into a dev-team chat. Unknown languages fall through to `loadLanguage()`
 * on demand (still async, but a one-off after the first occurrence) and then
 * to plaintext if shiki doesn't bundle the requested grammar.
 *
 * Aliases (`js`, `ts`, `py`, etc.) are resolved internally by shiki against
 * the loaded grammars, so we only list canonical names here.
 */
const PRELOAD_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "bash",
  "shell",
  "json",
  "yaml",
  "markdown",
  "html",
  "css",
  "sql",
  "rust",
  "go",
  "java",
  "ruby",
  "php",
  "diff",
] as const

const THEMES = ["github-light", "github-dark"] as const

type Lang = (typeof PRELOAD_LANGS)[number] | "plaintext"
type Theme = (typeof THEMES)[number]

let highlighter: HighlighterGeneric<Lang, Theme> | null = null
let initPromise: Promise<HighlighterGeneric<Lang, Theme>> | null = null

const CODE_TO_HTML_OPTIONS = {
  themes: { light: "github-light", dark: "github-dark" } as Record<"light" | "dark", Theme>,
  defaultColor: false as const,
}

/**
 * Boot the singleton highlighter. Safe to call multiple times — the same
 * promise is returned for in-flight initializations and the resolved
 * instance is cached afterwards. Failures aren't cached so a transient
 * dynamic-import error doesn't permanently disable highlighting.
 */
export function initHighlighter(): Promise<HighlighterGeneric<Lang, Theme>> {
  if (highlighter) return Promise.resolve(highlighter)
  if (initPromise) return initPromise
  initPromise = createHighlighter({
    langs: [...PRELOAD_LANGS],
    themes: [...THEMES],
  })
    .then((hl) => {
      highlighter = hl as HighlighterGeneric<Lang, Theme>
      return highlighter
    })
    .catch((err) => {
      initPromise = null
      throw err
    })
  return initPromise
}

function normalizeLanguage(lang: string): string {
  return lang.trim() || "plaintext"
}

/**
 * Synchronously highlight `code` if the highlighter is already initialized
 * and the requested language is loaded. Returns `null` otherwise — callers
 * fall through to `ensureHighlight`, which will load missing languages or
 * await the in-flight init.
 *
 * This is the hot path for paint-time render: if the singleton was warmed
 * during bootstrap, every code block lands with highlighted HTML on its
 * very first render, eliminating the placeholder → highlighted swap.
 */
export function tryHighlightSync(code: string, lang: string): string | null {
  const hl = highlighter
  if (!hl) return null
  const normalized = normalizeLanguage(lang)
  try {
    return hl.codeToHtml(code, { lang: normalized as Lang, ...CODE_TO_HTML_OPTIONS })
  } catch {
    return null
  }
}

/**
 * Always returns highlighted HTML (falling back to plaintext if the
 * requested language isn't bundled by shiki). Awaits init if the highlighter
 * is still warming, lazy-loads the language if it isn't pre-bundled.
 */
export async function ensureHighlight(code: string, lang: string): Promise<string | null> {
  let hl: HighlighterGeneric<Lang, Theme>
  try {
    hl = await initHighlighter()
  } catch {
    return null
  }
  const normalized = normalizeLanguage(lang)

  try {
    return hl.codeToHtml(code, { lang: normalized as Lang, ...CODE_TO_HTML_OPTIONS })
  } catch {
    // Language not pre-loaded — try to fetch it.
  }

  try {
    await hl.loadLanguage(normalized as Lang)
    return hl.codeToHtml(code, { lang: normalized as Lang, ...CODE_TO_HTML_OPTIONS })
  } catch {
    // Unknown or failed to fetch — render as plaintext so the block still
    // renders inside its panel rather than getting stuck on the placeholder.
    try {
      return hl.codeToHtml(code, { lang: "plaintext", ...CODE_TO_HTML_OPTIONS })
    } catch {
      return null
    }
  }
}

/**
 * Test helper. Drops the cached singleton so tests can assert the cold-path
 * `tryHighlightSync` returns null. Not exported via the index barrel.
 */
export function __resetHighlighterForTests(): void {
  highlighter = null
  initPromise = null
}
