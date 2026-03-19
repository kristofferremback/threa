# Link Previews Implementation Plan

## Overview

Add link unfurl/preview support for URLs in messages. Previews are fetched server-side via a background worker, rendered after message content (similar to attachments), and support per-user dismiss/collapse with a global default preference.

## Data Model

### `link_previews` — Cached metadata per URL per workspace

| Column         | Type                 | Notes                                                     |
| -------------- | -------------------- | --------------------------------------------------------- |
| id             | TEXT PK              | ULID prefixed `lp_`                                       |
| workspace_id   | TEXT NOT NULL        | Workspace scope                                           |
| url            | TEXT NOT NULL        | Original URL                                              |
| normalized_url | TEXT NOT NULL        | Deduplication key (lowercase host, strip tracking params) |
| title          | TEXT                 | OG/meta title                                             |
| description    | TEXT                 | OG/meta description                                       |
| image_url      | TEXT                 | OG image / thumbnail                                      |
| favicon_url    | TEXT                 | Site favicon                                              |
| site_name      | TEXT                 | og:site_name                                              |
| content_type   | TEXT NOT NULL        | 'website' / 'pdf' / 'image'                               |
| status         | TEXT NOT NULL        | 'pending' / 'completed' / 'failed'                        |
| fetched_at     | TIMESTAMPTZ          | When metadata was fetched                                 |
| created_at     | TIMESTAMPTZ NOT NULL | DEFAULT NOW()                                             |

UNIQUE(workspace_id, normalized_url)

### `message_link_previews` — Junction table

| Column          | Type             | Notes            |
| --------------- | ---------------- | ---------------- |
| message_id      | TEXT NOT NULL    |                  |
| link_preview_id | TEXT NOT NULL    |                  |
| position        | INTEGER NOT NULL | Order in message |

PK(message_id, link_preview_id)

### `user_link_preview_dismissals` — Per-user dismissals

| Column          | Type                 | Notes |
| --------------- | -------------------- | ----- |
| workspace_id    | TEXT NOT NULL        |       |
| user_id         | TEXT NOT NULL        |       |
| message_id      | TEXT NOT NULL        |       |
| link_preview_id | TEXT NOT NULL        |       |
| created_at      | TIMESTAMPTZ NOT NULL |       |

PK(workspace_id, user_id, message_id, link_preview_id)

## User Preference

Add `linkPreviewDefault: "open" | "collapsed"` to UserPreferences (default: "open").

## Backend Feature: `apps/backend/src/features/link-previews/`

### Files

- `repository.ts` — Data access for all three tables
- `service.ts` — URL extraction, preview resolution, dismissal management
- `worker.ts` — Background job: fetches OG/meta tags from URLs
- `handlers.ts` — HTTP handlers for preview retrieval and dismissal
- `config.ts` — Constants (MAX_PREVIEWS_PER_MESSAGE = 5, fetch timeout, etc.)
- `index.ts` — Barrel exports

### Worker Flow

1. Message created → EventService also enqueues `link_preview.extract` job
2. Worker extracts URLs from contentMarkdown
3. For each URL: check cache in link_previews table (by normalized_url)
4. For uncached URLs: fetch metadata (OG tags), insert into link_previews
5. Create message_link_previews junction records
6. Publish `link_preview:ready` outbox event → stream-scoped

### API Endpoints

- `GET /api/workspaces/:wid/messages/:mid/link-previews` — Get previews for a message
- `POST /api/workspaces/:wid/link-previews/:lpid/dismiss` — Dismiss (body: { messageId })
- `DELETE /api/workspaces/:wid/link-previews/:lpid/dismiss` — Un-dismiss (body: { messageId })

### Batch endpoint for bootstrap

- Include link preview data in stream bootstrap response (enriched into message_created event payloads)

## Frontend

### Components

- `LinkPreviewList` — Container: shows up to 3 previews, "Show N more" button for expansion
- `LinkPreviewCard` — Individual card with website/PDF/image variants
- `LinkPreviewContext` — Hover sync between inline links and preview cards

### Content Type Rendering

- **Website**: Favicon + title + description + image thumbnail. Bordered card with external indicator.
- **PDF**: PDF icon + title + description. Links to URL.
- **Image**: Inline thumbnail preview. Click opens in lightbox.

### UX

- Hover on inline link → highlights corresponding preview card (and vice versa)
- Each card has dismiss (X) button → per-user, persisted
- Collapsed state via user preference or per-card toggle
- "External content" badge on cards
- Show 3 by default, "Show N more" expansion for additional previews

## Outbox Events

- `link_preview:ready` — Stream-scoped, sent when previews for a message are resolved
  Payload: `{ workspaceId, streamId, messageId, previews: LinkPreviewSummary[] }`
