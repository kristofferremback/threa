import { createHighlighter, type HighlighterGeneric } from "shiki"

// Pre-loaded at boot so common code blocks paint highlighted on first render.
// Unknown langs fall through to `loadLanguage()` and then to plaintext.
// Aliases (`js`, `ts`, `py`) resolve internally against these canonical names.
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

// Lazy singleton: warmed on the first `ensureHighlight` call, then reused.
// Failures aren't cached so a transient dynamic-import error doesn't
// permanently disable highlighting; the next caller retries.
function initHighlighter(): Promise<HighlighterGeneric<Lang, Theme>> {
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

// Returns null when the highlighter isn't ready or the language isn't loaded;
// callers fall through to `ensureHighlight`. The null return is what lets a
// warmed highlighter skip the placeholder → highlighted swap on first paint.
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

// Awaits init, lazy-loads the language if missing, falls back to plaintext
// rather than leaving the block stuck on its unhighlighted placeholder.
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
