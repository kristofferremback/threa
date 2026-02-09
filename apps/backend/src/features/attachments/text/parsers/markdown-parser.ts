/**
 * Markdown Parser
 *
 * Extracts heading structure, TOC, and identifies code blocks/tables.
 */

import type { TextSection, MarkdownStructure } from "@threa/types"
import type { ParseResult, TextParser } from "./types"

const PREVIEW_LINES = 100

interface HeadingInfo {
  level: number
  text: string
  lineNumber: number
}

export const markdownParser: TextParser = {
  parse(content: string, _filename: string): ParseResult {
    const lines = content.split("\n")
    const totalLines = lines.length

    // Extract headings
    const headings: HeadingInfo[] = []
    let hasCodeBlocks = false
    let hasTables = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Detect headings (# syntax)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        headings.push({
          level: headingMatch[1].length,
          text: headingMatch[2].trim(),
          lineNumber: i,
        })
      }

      // Detect code blocks
      if (line.startsWith("```")) {
        hasCodeBlocks = true
      }

      // Detect tables (pipe-separated)
      if (line.includes("|") && !line.startsWith("|---")) {
        const pipeCount = (line.match(/\|/g) || []).length
        if (pipeCount >= 2) {
          hasTables = true
        }
      }
    }

    // Build TOC from headings
    const toc = headings.map((h) => {
      const indent = "  ".repeat(h.level - 1)
      return `${indent}${h.text}`
    })

    // Create sections from headings
    const sections: TextSection[] = []
    for (let i = 0; i < headings.length; i++) {
      const current = headings[i]
      const next = headings[i + 1]
      const endLine = next ? next.lineNumber : totalLines

      // Build heading path (for nested navigation)
      const ancestors: string[] = []
      for (let j = i - 1; j >= 0; j--) {
        if (headings[j].level < current.level) {
          ancestors.unshift(headings[j].text)
          if (headings[j].level === 1) break
        }
      }
      const path = [...ancestors, current.text].join(" > ")

      sections.push({
        type: "heading",
        path,
        title: current.text,
        startLine: current.lineNumber,
        endLine,
      })
    }

    // Preview is first N lines
    const previewContent = lines.slice(0, PREVIEW_LINES).join("\n")

    const structure: MarkdownStructure = {
      toc,
      hasCodeBlocks,
      hasTables,
    }

    return {
      format: "markdown",
      sections,
      structure,
      previewContent,
      totalLines,
    }
  },
}
