/**
 * ProseMirror / TipTap JSON types and validators.
 *
 * This module provides:
 * - JSONContent: Loose type for accepting input from TipTap/external sources
 * - ThreaDocument: Strict types for our schema (validated at boundary)
 * - Zod schemas for runtime validation
 * - Type guards and validators
 */

import { z } from "zod/v4"

// ============================================================================
// Loose Input Type (compatible with TipTap's JSONContent)
// ============================================================================

/**
 * Loose JSON content type, compatible with TipTap's JSONContent.
 * Use this for accepting input - validate at boundary before processing.
 */
export interface JSONContent {
  /** Node type name */
  type?: string
  /** Node attributes (any JSON-serializable value) */
  attrs?: Record<string, unknown>
  /** Child nodes */
  content?: JSONContent[]
  /** Marks applied to inline nodes */
  marks?: JSONContentMark[]
  /** Text content (only for text nodes) */
  text?: string
}

export interface JSONContentMark {
  type: string
  attrs?: Record<string, unknown>
}

// ============================================================================
// Strict Types for Threa's ProseMirror Schema
// ============================================================================

/**
 * Root document node - the top-level container for all content.
 */
export interface ThreaDocument {
  type: "doc"
  content: ThreaBlockNode[]
}

/**
 * Block-level nodes that can appear at the document level.
 */
export type ThreaBlockNode =
  | ThreaParagraph
  | ThreaHeading
  | ThreaCodeBlock
  | ThreaBlockquote
  | ThreaBulletList
  | ThreaOrderedList
  | ThreaHorizontalRule

/**
 * Paragraph - the basic text container.
 */
export interface ThreaParagraph {
  type: "paragraph"
  content?: ThreaInlineNode[]
}

/**
 * Heading levels 1-3.
 */
export interface ThreaHeading {
  type: "heading"
  attrs: {
    level: 1 | 2 | 3
  }
  content?: ThreaInlineNode[]
}

/**
 * Code block with optional language for syntax highlighting.
 */
export interface ThreaCodeBlock {
  type: "codeBlock"
  attrs?: {
    language?: string
  }
  content?: ThreaTextNode[]
}

/**
 * Blockquote for quoted text.
 */
export interface ThreaBlockquote {
  type: "blockquote"
  content: ThreaBlockNode[]
}

/**
 * Bullet (unordered) list.
 */
export interface ThreaBulletList {
  type: "bulletList"
  content: ThreaListItem[]
}

/**
 * Ordered (numbered) list.
 */
export interface ThreaOrderedList {
  type: "orderedList"
  attrs?: {
    start?: number
  }
  content: ThreaListItem[]
}

/**
 * List item - container for list content.
 */
export interface ThreaListItem {
  type: "listItem"
  content: ThreaBlockNode[]
}

/**
 * Horizontal rule / divider.
 */
export interface ThreaHorizontalRule {
  type: "horizontalRule"
}

/**
 * Inline-level nodes that can appear inside paragraphs, headings, etc.
 */
export type ThreaInlineNode =
  | ThreaTextNode
  | ThreaMention
  | ThreaChannelLink
  | ThreaCommand
  | ThreaEmoji
  | ThreaAttachmentReference
  | ThreaHardBreak

/**
 * Text node - plain text with optional marks.
 */
export interface ThreaTextNode {
  type: "text"
  text: string
  marks?: ThreaMark[]
}

/**
 * @mention node for users, personas, or broadcasts.
 */
export interface ThreaMention {
  type: "mention"
  attrs: {
    id: string
    slug: string
    mentionType: "user" | "persona" | "broadcast" | "me"
  }
}

/**
 * #channel link node.
 */
export interface ThreaChannelLink {
  type: "channelLink"
  attrs: {
    id: string
    slug: string
  }
}

/**
 * /command node for slash commands.
 */
export interface ThreaCommand {
  type: "command"
  attrs: {
    name: string
    args?: string
  }
}

/**
 * Emoji node (rendered from :shortcode:).
 */
export interface ThreaEmoji {
  type: "emoji"
  attrs: {
    shortcode: string
  }
}

/**
 * Attachment reference node for inline files/images.
 */
export interface ThreaAttachmentReference {
  type: "attachmentReference"
  attrs: {
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    status: "uploading" | "uploaded" | "error"
    imageIndex?: number | null
    error?: string | null
  }
}

/**
 * Hard break (Shift+Enter line break).
 */
export interface ThreaHardBreak {
  type: "hardBreak"
}

/**
 * Marks that can be applied to inline nodes.
 */
export type ThreaMark = ThreaBoldMark | ThreaItalicMark | ThreaStrikeMark | ThreaCodeMark | ThreaLinkMark

export interface ThreaBoldMark {
  type: "bold"
}

export interface ThreaItalicMark {
  type: "italic"
}

export interface ThreaStrikeMark {
  type: "strike"
}

export interface ThreaCodeMark {
  type: "code"
}

export interface ThreaLinkMark {
  type: "link"
  attrs: {
    href: string
    target?: string
    rel?: string
    class?: string
  }
}

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

// Marks
const boldMarkSchema = z.object({
  type: z.literal("bold"),
})

const italicMarkSchema = z.object({
  type: z.literal("italic"),
})

const strikeMarkSchema = z.object({
  type: z.literal("strike"),
})

const codeMarkSchema = z.object({
  type: z.literal("code"),
})

const linkMarkSchema = z.object({
  type: z.literal("link"),
  attrs: z.object({
    href: z.string(),
    target: z.string().optional(),
    rel: z.string().optional(),
    class: z.string().optional(),
  }),
})

const threaMarkSchema = z.union([boldMarkSchema, italicMarkSchema, strikeMarkSchema, codeMarkSchema, linkMarkSchema])

// Text node
const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(threaMarkSchema).optional(),
})

// Inline atom nodes
const mentionNodeSchema = z.object({
  type: z.literal("mention"),
  attrs: z.object({
    id: z.string(),
    slug: z.string(),
    mentionType: z.enum(["user", "persona", "broadcast", "me"]),
  }),
})

const channelLinkNodeSchema = z.object({
  type: z.literal("channelLink"),
  attrs: z.object({
    id: z.string(),
    slug: z.string(),
  }),
})

const commandNodeSchema = z.object({
  type: z.literal("command"),
  attrs: z.object({
    name: z.string(),
    args: z.string().optional(),
  }),
})

const emojiNodeSchema = z.object({
  type: z.literal("emoji"),
  attrs: z.object({
    shortcode: z.string(),
  }),
})

const attachmentReferenceNodeSchema = z.object({
  type: z.literal("attachmentReference"),
  attrs: z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    status: z.enum(["uploading", "uploaded", "error"]),
    imageIndex: z.number().nullable().optional(),
    error: z.string().nullable().optional(),
  }),
})

const hardBreakNodeSchema = z.object({
  type: z.literal("hardBreak"),
})

// Inline node union
const inlineNodeSchema: z.ZodType<ThreaInlineNode> = z.union([
  textNodeSchema,
  mentionNodeSchema,
  channelLinkNodeSchema,
  commandNodeSchema,
  emojiNodeSchema,
  attachmentReferenceNodeSchema,
  hardBreakNodeSchema,
])

// Block nodes (forward declared for recursion)
const paragraphNodeSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(inlineNodeSchema).optional(),
})

const headingNodeSchema = z.object({
  type: z.literal("heading"),
  attrs: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  }),
  content: z.array(inlineNodeSchema).optional(),
})

const codeBlockNodeSchema = z.object({
  type: z.literal("codeBlock"),
  attrs: z
    .object({
      language: z.string().optional(),
    })
    .optional(),
  content: z.array(textNodeSchema).optional(),
})

const horizontalRuleNodeSchema = z.object({
  type: z.literal("horizontalRule"),
})

// For recursive structures, we need to use z.lazy()
// Note: We cast to the expected type since Zod v4's inference doesn't perfectly match
// our strict types. Runtime validation still works correctly.
const blockNodeSchema = z.lazy(() =>
  z.union([
    paragraphNodeSchema,
    headingNodeSchema,
    codeBlockNodeSchema,
    blockquoteNodeSchema,
    bulletListNodeSchema,
    orderedListNodeSchema,
    horizontalRuleNodeSchema,
  ])
) as unknown as z.ZodType<ThreaBlockNode>

const listItemNodeSchema = z.object({
  type: z.literal("listItem"),
  content: z.array(blockNodeSchema),
})

const blockquoteNodeSchema = z.object({
  type: z.literal("blockquote"),
  content: z.array(blockNodeSchema),
})

const bulletListNodeSchema = z.object({
  type: z.literal("bulletList"),
  content: z.array(listItemNodeSchema),
})

const orderedListNodeSchema = z.object({
  type: z.literal("orderedList"),
  attrs: z
    .object({
      start: z.number().optional(),
    })
    .optional(),
  content: z.array(listItemNodeSchema),
})

/**
 * Zod schema for validating a ThreaDocument.
 */
export const threaDocumentSchema: z.ZodType<ThreaDocument> = z.object({
  type: z.literal("doc"),
  content: z.array(blockNodeSchema),
})

// ============================================================================
// Type Guards and Validators
// ============================================================================

/**
 * Custom error for content validation failures.
 */
export class ContentValidationError extends Error {
  constructor(public readonly zodError: z.core.$ZodError) {
    super(`Content validation failed: ${zodError.message}`)
    this.name = "ContentValidationError"
  }
}

/**
 * Check if content is a valid ThreaDocument.
 */
export function isThreaDocument(content: JSONContent): content is ThreaDocument {
  return threaDocumentSchema.safeParse(content).success
}

/**
 * Validate and narrow JSONContent to ThreaDocument.
 * Throws ContentValidationError if validation fails.
 */
export function validateContent(content: JSONContent): ThreaDocument {
  const result = threaDocumentSchema.safeParse(content)
  if (!result.success) {
    throw new ContentValidationError(result.error)
  }
  return result.data
}

/**
 * Attempt to validate content, returning null on failure.
 */
export function tryValidateContent(content: JSONContent): ThreaDocument | null {
  const result = threaDocumentSchema.safeParse(content)
  return result.success ? result.data : null
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract all node types from a ThreaDocument.
 */
export type ThreaNodeType = ThreaBlockNode["type"] | ThreaInlineNode["type"]

/**
 * Extract all mark types.
 */
export type ThreaMarkType = ThreaMark["type"]
