import { sql, type Querier } from "../db"
import type {
  ExtractionContentType,
  ExtractionSourceType,
  PdfSizeTier,
  ChartData,
  TableData,
  DiagramData,
} from "@threa/types"

// Internal row type (snake_case)
interface AttachmentExtractionRow {
  id: string
  attachment_id: string
  workspace_id: string
  content_type: string
  summary: string
  full_text: string | null
  structured_data: unknown | null
  source_type: string
  pdf_metadata: unknown | null
  created_at: Date
  updated_at: Date
}

// PDF-specific metadata
export interface PdfMetadata {
  totalPages: number
  sizeTier: PdfSizeTier
  sections?: PdfSection[]
}

export interface PdfSection {
  startPage: number
  endPage: number
  title: string
}

// Domain type (camelCase)
export interface AttachmentExtraction {
  id: string
  attachmentId: string
  workspaceId: string
  contentType: ExtractionContentType
  summary: string
  fullText: string | null
  structuredData: ChartData | TableData | DiagramData | null
  sourceType: ExtractionSourceType
  pdfMetadata: PdfMetadata | null
  createdAt: Date
  updatedAt: Date
}

export interface InsertAttachmentExtractionParams {
  id: string
  attachmentId: string
  workspaceId: string
  contentType: ExtractionContentType
  summary: string
  fullText?: string | null
  structuredData?: ChartData | TableData | DiagramData | null
  sourceType?: ExtractionSourceType
  pdfMetadata?: PdfMetadata | null
}

function mapRowToExtraction(row: AttachmentExtractionRow): AttachmentExtraction {
  return {
    id: row.id,
    attachmentId: row.attachment_id,
    workspaceId: row.workspace_id,
    contentType: row.content_type as ExtractionContentType,
    summary: row.summary,
    fullText: row.full_text,
    structuredData: row.structured_data as ChartData | TableData | DiagramData | null,
    sourceType: row.source_type as ExtractionSourceType,
    pdfMetadata: row.pdf_metadata as PdfMetadata | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_FIELDS = `
  id, attachment_id, workspace_id,
  content_type, summary, full_text, structured_data,
  source_type, pdf_metadata,
  created_at, updated_at
`

export const AttachmentExtractionRepository = {
  async insert(client: Querier, params: InsertAttachmentExtractionParams): Promise<AttachmentExtraction> {
    const result = await client.query<AttachmentExtractionRow>(sql`
      INSERT INTO attachment_extractions (
        id, attachment_id, workspace_id,
        content_type, summary, full_text, structured_data,
        source_type, pdf_metadata
      )
      VALUES (
        ${params.id},
        ${params.attachmentId},
        ${params.workspaceId},
        ${params.contentType},
        ${params.summary},
        ${params.fullText ?? null},
        ${params.structuredData ? JSON.stringify(params.structuredData) : null},
        ${params.sourceType ?? "image"},
        ${params.pdfMetadata ? JSON.stringify(params.pdfMetadata) : null}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToExtraction(result.rows[0])
  },

  async findByAttachmentId(client: Querier, attachmentId: string): Promise<AttachmentExtraction | null> {
    const result = await client.query<AttachmentExtractionRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachment_extractions WHERE attachment_id = ${attachmentId}`
    )
    return result.rows[0] ? mapRowToExtraction(result.rows[0]) : null
  },

  async findByAttachmentIds(client: Querier, attachmentIds: string[]): Promise<Map<string, AttachmentExtraction>> {
    if (attachmentIds.length === 0) return new Map()

    const result = await client.query<AttachmentExtractionRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachment_extractions WHERE attachment_id = ANY(${attachmentIds})`
    )

    const byAttachment = new Map<string, AttachmentExtraction>()
    for (const row of result.rows) {
      byAttachment.set(row.attachment_id, mapRowToExtraction(row))
    }
    return byAttachment
  },

  async findByWorkspace(
    client: Querier,
    workspaceId: string,
    options?: {
      contentType?: ExtractionContentType
      limit?: number
      offset?: number
    }
  ): Promise<AttachmentExtraction[]> {
    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0

    if (options?.contentType) {
      const result = await client.query<AttachmentExtractionRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM attachment_extractions
        WHERE workspace_id = ${workspaceId} AND content_type = ${options.contentType}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)
      return result.rows.map(mapRowToExtraction)
    }

    const result = await client.query<AttachmentExtractionRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM attachment_extractions
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows.map(mapRowToExtraction)
  },

  async deleteByAttachmentId(client: Querier, attachmentId: string): Promise<boolean> {
    const result = await client.query(sql`
      DELETE FROM attachment_extractions WHERE attachment_id = ${attachmentId}
    `)
    return (result.rowCount ?? 0) > 0
  },
}
