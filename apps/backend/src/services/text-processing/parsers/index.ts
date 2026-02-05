/**
 * Parser Registry
 *
 * Returns the appropriate parser for a given text format.
 */

import type { TextFormat } from "@threa/types"
import type { TextParser } from "./types"
import { plainTextParser } from "./plain-text-parser"
import { markdownParser } from "./markdown-parser"
import { jsonParser } from "./json-parser"
import { yamlParser } from "./yaml-parser"
import { csvParser } from "./csv-parser"
import { codeParser } from "./code-parser"

export type { ParseResult, TextParser } from "./types"

const PARSERS: Record<TextFormat, TextParser> = {
  plain: plainTextParser,
  markdown: markdownParser,
  json: jsonParser,
  yaml: yamlParser,
  csv: csvParser,
  code: codeParser,
}

/**
 * Get the parser for a given text format.
 */
export function getParser(format: TextFormat): TextParser {
  return PARSERS[format]
}
