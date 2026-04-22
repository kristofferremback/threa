import { logger } from "../../lib/logger"
import {
  LinearPreviewTypes,
  type LinearActor,
  type LinearCommentPreviewData,
  type LinearDocumentPreviewData,
  type LinearIssueLabel,
  type LinearIssuePreviewData,
  type LinearIssueState,
  type LinearOrganizationSummary,
  type LinearPreview,
  type LinearProjectPreviewData,
  type LinearTeam,
} from "@threa/types"
import type { UpdateLinkPreviewParams } from "./repository"
import { parseLinearUrl, type LinearUrlMatch } from "./url-utils"
import type { WorkspaceIntegrationService } from "../workspace-integrations"
import type { LinearClient } from "../workspace-integrations"

const log = logger.child({ module: "linear-link-preview" })

const LINEAR_FAVICON_URL = "https://linear.app/favicon.ico"
const COMMENT_PREVIEW_MAX_LENGTH = 320
const PROJECT_DESCRIPTION_MAX_LENGTH = 320
const DOCUMENT_SUMMARY_MAX_LENGTH = 240

type LinearClientLike = Pick<LinearClient, "request" | "organization">

interface ServiceLike {
  getLinearClient(workspaceId: string): Promise<LinearClientLike | null>
}

/**
 * Fetch a rich Linear preview for a `linear.app` URL.
 *
 * Returns null when:
 * - The URL is not a Linear URL or uses a different workspace slug than the
 *   connected Linear org
 * - The workspace has no active Linear integration or is near its rate limit
 * - The underlying entity was not found, or any Linear API error occurred
 *
 * A null return causes the worker to fall back to the generic HTML metadata
 * fetcher (which will see Linear's login wall and correctly yield no preview).
 */
export async function fetchLinearPreview(
  workspaceId: string,
  url: string,
  workspaceIntegrationService: ServiceLike
): Promise<UpdateLinkPreviewParams | null> {
  const parsed = parseLinearUrl(url)
  if (!parsed) return null

  const client = await workspaceIntegrationService.getLinearClient(workspaceId)
  if (!client) return null

  const org = client.organization
  if (!org.organizationUrlKey || !org.organizationId || !org.organizationName) return null
  if (parsed.workspaceSlug.toLowerCase() !== org.organizationUrlKey.toLowerCase()) {
    return null
  }

  const organizationSummary: LinearOrganizationSummary = {
    id: org.organizationId,
    urlKey: org.organizationUrlKey,
    name: org.organizationName,
  }

  try {
    const fetchedAt = new Date().toISOString()
    switch (parsed.type) {
      case "linear_issue":
        return await fetchIssuePreview(client, url, organizationSummary, parsed, fetchedAt)
      case "linear_comment":
        return await fetchCommentPreview(client, url, organizationSummary, parsed, fetchedAt)
      case "linear_project":
        return await fetchProjectPreview(client, url, organizationSummary, parsed, fetchedAt)
      case "linear_document":
        return await fetchDocumentPreview(client, url, organizationSummary, parsed, fetchedAt)
    }
  } catch (error) {
    log.debug({ err: error, workspaceId, url }, "Falling back from Linear preview to generic preview")
    return null
  }
}

// ── Issue ───────────────────────────────────────────────────────────────

const ISSUE_QUERY = /* GraphQL */ `
  query ThreaIssuePreview($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      url
      priority
      priorityLabel
      estimate
      dueDate
      state {
        name
        type
        color
      }
      assignee {
        id
        name
        displayName
        avatarUrl
      }
      team {
        key
        name
      }
      labels(first: 10) {
        nodes {
          name
          color
        }
      }
      project {
        id
        name
      }
      createdAt
      updatedAt
    }
  }
`

async function fetchIssuePreview(
  client: LinearClientLike,
  url: string,
  organization: LinearOrganizationSummary,
  parsed: Extract<LinearUrlMatch, { type: "linear_issue" }>,
  fetchedAt: string
): Promise<UpdateLinkPreviewParams | null> {
  const { issue } = await client.request<{ issue: LinearIssueNode | null }>(ISSUE_QUERY, { id: parsed.identifier })
  if (!issue) return null

  const data = toIssuePreviewData(issue)
  const preview: LinearPreview = {
    type: LinearPreviewTypes.ISSUE,
    url,
    organization,
    data,
    fetchedAt,
  }

  const isOpen = data.state.type !== "completed" && data.state.type !== "canceled"
  return {
    title: `${data.identifier}: ${data.title}`,
    description: buildIssueDescription(data),
    imageUrl: data.assignee?.avatarUrl ?? null,
    faviconUrl: LINEAR_FAVICON_URL,
    siteName: "Linear",
    contentType: "website",
    previewType: LinearPreviewTypes.ISSUE,
    previewData: preview,
    status: "completed",
    expiresAt: isOpen ? minutesFromNow(5) : hoursFromNow(1),
  }
}

// ── Comment ─────────────────────────────────────────────────────────────

const COMMENT_QUERY = /* GraphQL */ `
  query ThreaCommentPreview($id: String!) {
    comment(id: $id) {
      id
      body
      createdAt
      user {
        id
        name
        displayName
        avatarUrl
      }
      issue {
        identifier
        title
        team {
          key
          name
        }
        state {
          name
          type
          color
        }
      }
    }
  }
`

async function fetchCommentPreview(
  client: LinearClientLike,
  url: string,
  organization: LinearOrganizationSummary,
  parsed: Extract<LinearUrlMatch, { type: "linear_comment" }>,
  fetchedAt: string
): Promise<UpdateLinkPreviewParams | null> {
  const { comment } = await client.request<{ comment: LinearCommentNode | null }>(COMMENT_QUERY, {
    id: parsed.commentId,
  })
  if (!comment || !comment.issue) return null

  const body = typeof comment.body === "string" ? comment.body : ""
  const truncated = body.length > COMMENT_PREVIEW_MAX_LENGTH
  const data: LinearCommentPreviewData = {
    body: truncated ? `${body.slice(0, COMMENT_PREVIEW_MAX_LENGTH)}…` : body,
    truncated,
    author: toLinearActor(comment.user),
    createdAt: comment.createdAt,
    parent: {
      identifier: comment.issue.identifier,
      title: comment.issue.title,
      team: toLinearTeam(comment.issue.team),
      state: toLinearIssueState(comment.issue.state),
    },
  }

  const preview: LinearPreview = {
    type: LinearPreviewTypes.COMMENT,
    url,
    organization,
    data,
    fetchedAt,
  }

  return {
    title: `${data.parent.identifier} · Comment`,
    description: data.body,
    imageUrl: data.author?.avatarUrl ?? null,
    faviconUrl: LINEAR_FAVICON_URL,
    siteName: "Linear",
    contentType: "website",
    previewType: LinearPreviewTypes.COMMENT,
    previewData: preview,
    status: "completed",
    expiresAt: minutesFromNow(15),
  }
}

// ── Project ─────────────────────────────────────────────────────────────

const PROJECT_QUERY = /* GraphQL */ `
  query ThreaProjectPreview($slugId: String!) {
    projects(filter: { slugId: { eq: $slugId } }, first: 1) {
      nodes {
        id
        name
        description
        state
        progress
        startDate
        targetDate
        lead {
          id
          name
          displayName
          avatarUrl
        }
      }
    }
  }
`

async function fetchProjectPreview(
  client: LinearClientLike,
  url: string,
  organization: LinearOrganizationSummary,
  parsed: Extract<LinearUrlMatch, { type: "linear_project" }>,
  fetchedAt: string
): Promise<UpdateLinkPreviewParams | null> {
  const { projects } = await client.request<{ projects: { nodes: LinearProjectNode[] } }>(PROJECT_QUERY, {
    slugId: parsed.slugId,
  })
  const node = projects?.nodes?.[0]
  if (!node) return null

  const description = typeof node.description === "string" ? node.description : null
  const truncatedDescription = truncateWithEllipsis(description, PROJECT_DESCRIPTION_MAX_LENGTH)

  const data: LinearProjectPreviewData = {
    name: node.name,
    description: truncatedDescription,
    status: typeof node.state === "string" ? node.state : "",
    progress: typeof node.progress === "number" ? node.progress : 0,
    lead: toLinearActor(node.lead),
    targetDate: typeof node.targetDate === "string" ? node.targetDate : null,
    startDate: typeof node.startDate === "string" ? node.startDate : null,
  }

  const preview: LinearPreview = {
    type: LinearPreviewTypes.PROJECT,
    url,
    organization,
    data,
    fetchedAt,
  }

  return {
    title: data.name,
    description: truncatedDescription ?? data.status,
    imageUrl: data.lead?.avatarUrl ?? null,
    faviconUrl: LINEAR_FAVICON_URL,
    siteName: "Linear",
    contentType: "website",
    previewType: LinearPreviewTypes.PROJECT,
    previewData: preview,
    status: "completed",
    expiresAt: minutesFromNow(15),
  }
}

// ── Document ────────────────────────────────────────────────────────────

const DOCUMENT_QUERY = /* GraphQL */ `
  query ThreaDocumentPreview($slugId: String!) {
    documents(filter: { slugId: { eq: $slugId } }, first: 1) {
      nodes {
        id
        title
        content
        createdAt
        updatedAt
        updatedBy {
          id
          name
          displayName
          avatarUrl
        }
        project {
          id
          name
        }
      }
    }
  }
`

async function fetchDocumentPreview(
  client: LinearClientLike,
  url: string,
  organization: LinearOrganizationSummary,
  parsed: Extract<LinearUrlMatch, { type: "linear_document" }>,
  fetchedAt: string
): Promise<UpdateLinkPreviewParams | null> {
  const { documents } = await client.request<{ documents: { nodes: LinearDocumentNode[] } }>(DOCUMENT_QUERY, {
    slugId: parsed.slugId,
  })
  const node = documents?.nodes?.[0]
  if (!node) return null

  const rawSummary = typeof node.content === "string" ? node.content.trim() : ""
  const summary = rawSummary.length > 0 ? truncateWithEllipsis(rawSummary, DOCUMENT_SUMMARY_MAX_LENGTH) : null

  const parentProject = node.project ? { id: node.project.id, name: node.project.name } : null

  const data: LinearDocumentPreviewData = {
    title: node.title,
    summary,
    updatedBy: toLinearActor(node.updatedBy),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    parentProject,
  }

  const preview: LinearPreview = {
    type: LinearPreviewTypes.DOCUMENT,
    url,
    organization,
    data,
    fetchedAt,
  }

  return {
    title: data.title,
    description: summary ?? (parentProject ? `Document in ${parentProject.name}` : null),
    imageUrl: data.updatedBy?.avatarUrl ?? null,
    faviconUrl: LINEAR_FAVICON_URL,
    siteName: "Linear",
    contentType: "website",
    previewType: LinearPreviewTypes.DOCUMENT,
    previewData: preview,
    status: "completed",
    expiresAt: hoursFromNow(1),
  }
}

// ── Shared node→domain converters ──────────────────────────────────────

interface LinearUserNode {
  id?: unknown
  name?: unknown
  displayName?: unknown
  avatarUrl?: unknown
}

interface LinearTeamNode {
  key?: unknown
  name?: unknown
}

interface LinearStateNode {
  name?: unknown
  type?: unknown
  color?: unknown
}

interface LinearLabelNode {
  name?: unknown
  color?: unknown
}

interface LinearIssueNode {
  id: string
  identifier: string
  title: string
  priority?: number | null
  priorityLabel?: string | null
  estimate?: number | null
  dueDate?: string | null
  state: LinearStateNode
  assignee: LinearUserNode | null
  team: LinearTeamNode
  labels?: { nodes?: LinearLabelNode[] } | null
  project?: { id?: string; name?: string } | null
  createdAt: string
  updatedAt: string
}

interface LinearCommentNode {
  id: string
  body?: string
  createdAt: string
  user: LinearUserNode | null
  issue: {
    identifier: string
    title: string
    team: LinearTeamNode
    state: LinearStateNode
  } | null
}

interface LinearProjectNode {
  id: string
  name: string
  description?: string | null
  state?: string | null
  progress?: number | null
  startDate?: string | null
  targetDate?: string | null
  lead?: LinearUserNode | null
}

interface LinearDocumentNode {
  id: string
  title: string
  content?: string | null
  createdAt: string
  updatedAt: string
  updatedBy?: LinearUserNode | null
  project?: { id: string; name: string } | null
}

function toIssuePreviewData(issue: LinearIssueNode): LinearIssuePreviewData {
  const labels: LinearIssueLabel[] = (issue.labels?.nodes ?? [])
    .flatMap((label) => {
      if (typeof label.name !== "string") return []
      return [{ name: label.name, color: normalizeColor(label.color) }]
    })
    .slice(0, 10)

  const priorityValue = typeof issue.priority === "number" && Number.isFinite(issue.priority) ? issue.priority : null
  const priorityLabel = typeof issue.priorityLabel === "string" ? issue.priorityLabel : null
  const priority =
    priorityValue !== null && priorityLabel !== null ? { label: priorityLabel, value: priorityValue } : null

  return {
    identifier: issue.identifier,
    title: issue.title,
    state: toLinearIssueState(issue.state),
    priority,
    team: toLinearTeam(issue.team),
    assignee: toLinearActor(issue.assignee),
    labels,
    estimate: typeof issue.estimate === "number" ? issue.estimate : null,
    dueDate: typeof issue.dueDate === "string" ? issue.dueDate : null,
    projectName: issue.project?.name ?? null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  }
}

function buildIssueDescription(data: LinearIssuePreviewData): string {
  const parts: string[] = [`${data.team.key}`, data.state.name]
  if (data.priority) parts.push(data.priority.label)
  if (data.assignee) parts.push(`@${data.assignee.displayName}`)
  return parts.join(" · ")
}

function toLinearActor(node: LinearUserNode | null | undefined): LinearActor | null {
  if (!node || typeof node.id !== "string" || typeof node.name !== "string") return null
  return {
    id: node.id,
    name: node.name,
    displayName: typeof node.displayName === "string" ? node.displayName : node.name,
    avatarUrl: typeof node.avatarUrl === "string" ? node.avatarUrl : null,
  }
}

function toLinearTeam(node: LinearTeamNode): LinearTeam {
  return {
    key: typeof node.key === "string" ? node.key : "",
    name: typeof node.name === "string" ? node.name : "",
  }
}

function toLinearIssueState(node: LinearStateNode): LinearIssueState {
  return {
    name: typeof node.name === "string" ? node.name : "",
    type: typeof node.type === "string" ? node.type : "unstarted",
    color: normalizeColor(node.color),
  }
}

/** Normalize a Linear color value — keeps leading `#`, strips whitespace. */
function normalizeColor(value: unknown): string {
  if (typeof value !== "string") return "#95A2B3"
  const trimmed = value.trim()
  return trimmed || "#95A2B3"
}

function truncateWithEllipsis(value: string | null, maxLength: number): string | null {
  if (value === null) return null
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000)
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}
