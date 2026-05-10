# Attachment Explorer

## Context

Threa surfaces uploaded files only inline within their original message. Once a conversation moves on, attachments become hard to find again — there is no "all PDFs in #strategy from last month" or "every image @mira ever uploaded" view. This adds an explorer that lists workspace attachments most-recent-first, reusing the message-search filter language users already know, with inline preview, extract viewing, and a jump-back link to the source message.

Backend pieces already exist: `attachments` table has a `tsvector` on filename + extracted_text, `attachment_extractions` (1:1) has its own tsvector on summary + full_text, `attachment_references` records every message that quotes a file, and `streams.root_stream_id` already encodes thread→channel relationships. The work is mostly a new search endpoint and a new modal UI.

The explorer opens as a modal from three entry points: the per-stream `…` menu (scope = current stream/thread), the sidebar Quick Links section (workspace-wide), and the quick switcher as a `>` command.

## Visual concept

Two-pane modal in the existing `ResponsiveDialog` shell, matching the quick switcher's voice (`rounded-2xl`, soft `0_0_0_2px hsl(var(--primary)/0.06)` focus ring, Space Grotesk).

```
┌─ Files ────────────────────────────────────────────────┐
│ [search filename, content…                          ]  │
│ in:#design ✕   type:image ✕   + filter ▾   [List|Grid] │
│ ────────────────────────────────────────────────────── │
│  LIST (left, ~55%)            │  PREVIEW PANE (right)  │
│  Today                        │  [ image / pdf page ]  │
│   ▣ logo.svg  #design Mira    │                        │
│   ▣ Q2.pdf    #strat Joe      │  logo.svg              │
│  Yesterday                    │  Posted by Mira        │
│   …                           │  in #design · 3:42 PM  │
│                               │                        │
│                               │  Extract ▾ [excerpt]   │
│                               │  ↳ Open in #design     │
│                               │  Referenced by 2 msgs  │
│                               │  Download · Delete*    │
│ ↑↓ navigate · ↵ open · esc close                       │
└────────────────────────────────────────────────────────┘
```

- **List rows**: 32×32 thumbnail (image preview, or category-tinted icon), filename, "in #stream · uploader · time" muted meta, single-line ellipsis. Day-grouped non-sticky headers (Today / Yesterday / This week / Month / Older).
- **Right pane**: live preview switched by category. Image/video reuse `MediaGallery`; PDFs render first page + extract excerpt; text/code/docs render the extract; audio shows play button + transcript excerpt.
- **Grid toggle**: swaps the list for a 4-column masonry of media — useful when filtered to `type:image`.
- **Mobile**: image/video row tap → `MediaGallery` fullscreen directly (matches today's timeline). Non-media tap → `Drawer` with preview-pane content.
- **Empty/loading**: skeleton rows during first page; filtered-empty shows "Nothing in this scope" with [Clear filters] and [Search across workspace] buttons.

## Search semantics

Reuse the parser at `apps/frontend/src/components/quick-switcher/search-query-parser.ts` — extend with `name:` and `type:` filter types. Final filter set:

| Filter | Behavior |
|---|---|
| `in:#stream` | Scope; backend expands to thread descendants via `root_stream_id` CTE |
| `from:@user` | Uploader (`uploaded_by`) |
| `type:image,pdf` | One or more `AttachmentCategory` values |
| `name:"invoice-2026"` | Substring match on `filename` only (ILIKE) |
| `before:2026-04-01` / `after:2026-01-01` | `created_at` range |
| Free text | `websearch_to_tsquery` against `attachments.search_vector ‖ extractions.search_vector` |
| `"quoted phrase"` | ILIKE against `filename ‖ extracted_text ‖ summary ‖ full_text` (mirrors `apps/frontend/src/api/search.ts` `exact` for messages) |

Removing the `in:` chip with X de-scopes — same `removeFilterFromQuery` flow as `apps/frontend/src/components/quick-switcher/use-search-items.tsx:152-156`.

**Thread scoping (option C)**: when opened from a thread panel, default scope is the thread itself. The chip rail surfaces a one-click banner **"Include #parent (parent channel)"** that swaps the scope to the thread's `rootStreamId`. Removing the `in:` chip after that drops to workspace-wide.

## URL state (INV-59)

Modal state lives in URL search params on whatever page the user is on, so the modal is shareable, refresh-survivable, and back/forward-navigable:

```
?explorer=open
&scope=stream-{id}    // omitted = workspace-wide
&q=invoice
&type=image,pdf
&from={userId}
&name=q2-roadmap
&before=2026-04-01
&after=2026-01-01
&view=list            // or "grid"
&selected={attachmentId}
```

The cursor is *not* in the URL — `useInfiniteQuery` manages it. Opening pushes params; closing strips them via `navigate({ search: "" }, { replace: true })`. The hook reads via `useSearchParams()` as the single source of truth — no duplicate `useState`.

## Data model

**No schema changes needed.** Reused as-is:

- `attachments` (`apps/backend/src/db/migrations/20251210155323_core_schema.sql:171-200`): `workspace_id`, `stream_id?`, `message_id?`, `filename`, `mime_type`, `size_bytes`, `processing_status`, `safety_status`, `uploaded_by`, `created_at`, `search_vector`.
- `attachment_extractions` (`apps/backend/src/db/migrations/20260202165446_attachment_extractions.sql`): `summary`, `full_text`, `structured_data`, `content_type`, `search_vector`.
- `attachment_references` (`apps/backend/src/db/migrations/20260428120000_attachment_references.sql`): `(attachment_id, message_id)` for re-shared/copied attachments.
- `streams.parent_stream_id` / `streams.root_stream_id` (`apps/backend/src/db/migrations/20251210155323_core_schema.sql:48-50`).

**New shared helper**: `packages/types/src/attachment-categories.ts` — exports `AttachmentCategory = "image"|"video"|"audio"|"pdf"|"doc"|"sheet"|"slide"|"code"|"archive"|"other"` and `categoryFromMime(mime: string): AttachmentCategory`. Used by backend filter resolution and frontend icon/accent rendering. Constants live here, no magic strings (INV-33). Re-export from `packages/types/src/index.ts`.

## Backend changes

**1. Repo extension** — `apps/backend/src/features/attachments/repository.ts`:

- New method `search({ workspaceId, streamIds?, categories?, uploadedBy?, before?, after?, queryText?, exact?, nameSubstring?, cursor?, limit })`.
- For `streamIds`, expand server-side via CTE: `WITH scoped AS (SELECT id FROM streams WHERE id = ANY($streamIds) OR root_stream_id = ANY($streamIds))` — single round trip, callers don't have to know about thread structure.
- FTS via `websearch_to_tsquery('simple', $1)` against `(attachments.search_vector || coalesce(extractions.search_vector, ''))` for the non-exact path.
- `nameSubstring` and exact `queryText` use ILIKE.
- `categories` resolves to a `mime_type` prefix list (e.g. `image/% ‖ video/%`) via `categoryFromMime` (run on a small enumeration of known mimes for the prefix expansion; unknown mimes fall to `other`).
- Keyset cursor on `(created_at DESC, id DESC)`; cursor format `{createdAtIso}|{id}` base64-encoded.
- `LEFT JOIN attachment_extractions` so each row carries the extract excerpt — avoids a second round trip per row for the preview pane.

**2. New handler** — `apps/backend/src/features/attachments/handlers.ts`, registered as `POST /api/workspaces/:workspaceId/attachments/search`:

- Zod schema for the body (INV-55), `HttpError` for failures (INV-32).
- Calls the existing readable-stream gating from `apps/backend/src/features/streams/access.ts:118-134` and intersects with any incoming `streamIds` filter so streams the caller can't read never leak through metadata.
- Returns `{ items: AttachmentSearchResult[], nextCursor: string | null }` where `AttachmentSearchResult = Attachment + { extractSummary?: string, referenceCount: number, streamSlug: string, uploaderSlug: string }`.
- Frontend formats dates / sizes (INV-46). No English-only heuristics anywhere (INV-54).

**3. Tests** — `apps/backend/src/features/attachments/handlers.test.ts` + `repository.test.ts`:

- Workspace isolation
- Thread descendant inclusion via `root_stream_id`
- Hidden-stream gating (caller without access to `#design` cannot see its files via workspace-wide scope)
- Quoted-substring vs FTS path produce different result sets where they should
- Cursor pagination correctness across deletes
- Category filter mime resolution
- Behavior assertions, not event-count assertions (INV-23); single object comparison where it fits (INV-24).

## Frontend changes

**1. New feature folder** — `apps/frontend/src/components/attachment-explorer/`:

```
attachment-explorer.tsx       // ResponsiveDialog shell, URL→state binding, keyboard nav
explorer-list.tsx             // react-virtuoso list with day-group headers
explorer-row.tsx              // 32×32 thumbnail + meta + … menu
explorer-preview.tsx          // right pane router by category
preview/
  image-preview.tsx           // wraps MediaGallery
  pdf-preview.tsx
  doc-preview.tsx             // extract text view
  audio-preview.tsx
  video-preview.tsx
explorer-filters.tsx          // chip rail + + filter dropdown (lifts FilterSelect)
explorer-empty.tsx            // empty/loading/error states
use-attachment-search.ts      // useInfiniteQuery against the new endpoint
use-explorer-url-state.ts     // useSearchParams ↔ filter object
use-explorer-controller.ts    // openExplorer({ scope }) helper for entry points
category.ts                   // re-exports + UI metadata (icon, accent token)
index.ts                      // public barrel (INV-52)
```

**2. API client** — extend `apps/frontend/src/api/attachments.ts` with `attachmentsApi.search(workspaceId, body): Promise<{ items, nextCursor }>`.

**3. Entry points**:

- **Stream context menu** — append at `apps/frontend/src/components/thread/stream-panel.tsx:199-214`:
  ```ts
  panelMenuActions.push({
    id: "browse-files",
    label: "Browse files…",
    icon: Paperclip,
    onSelect: () => openExplorer({ scope: panelId }),
  })
  ```
- **Sidebar Quick Links** — insert "Files" entry between Saved and Scheduled at `apps/frontend/src/components/layout/sidebar/quick-links.tsx:50-106` as a `<Link to={\`/w/${workspaceId}?explorer=open\`}>` (INV-40 — navigation uses links).
- **Quick switcher command** — add at `apps/frontend/src/components/quick-switcher/commands.ts`:
  ```ts
  {
    id: "browse-files",
    label: "Browse files",
    keywords: ["attachments", "uploads", "media", "files"],
    icon: Paperclip,
    action: ({ openExplorer }) => openExplorer({ scope: "workspace" }),
  }
  ```
  Thread `openExplorer` through `CommandContext` the same way `openCreateChannel` / `openSettings` are passed in `apps/frontend/src/components/quick-switcher/quick-switcher.tsx:135-147`.
- **Keyboard shortcut** — `⌘⇧F` opens with current page's stream as scope when on a stream, workspace otherwise. Register alongside existing global hotkeys.

**4. Reused utilities** (do NOT reimplement — INV-35, INV-37):

| Need | Source |
|---|---|
| Infinite list virtualization | `react-virtuoso` (already used in `apps/frontend/src/components/timeline/stream-content.tsx:3`) |
| Image/video lightbox | `MediaGallery` (`apps/frontend/src/components/image-gallery.tsx`) |
| Pagination shape | `useInfiniteQuery` pattern (`apps/frontend/src/hooks/use-events.ts:196-200`) |
| Filter chip rail + picker | `FilterSelect` + chip rail (`apps/frontend/src/components/quick-switcher/use-search-items.tsx:184-234`) |
| Query parsing | `parseSearchQuery` / `removeFilterFromQuery` / `addFilterToQuery` (`search-query-parser.ts`) |
| Modal shell | `ResponsiveDialog` + `Drawer` (`apps/frontend/src/components/ui/responsive-dialog.tsx`, `drawer.tsx`) |
| Date rendering | `formatDate(date, timezone, format)` from `lib/temporal.ts` (INV-42) |

**5. Row `…` menu — Delete**: present on every row but disabled with tooltip "Already in a message — delete the message instead" unless the attachment is unattached (`message_id IS NULL` and `referenceCount === 0`). Mirrors the existing constraint at `apps/frontend/src/api/attachments.ts:88`.

**6. Tests**:

- `use-explorer-url-state.test.ts` — round-trip filter object ↔ search params; navigate back/forward preserves view.
- `attachment-explorer.integration.test.tsx` — open from each entry point, type a filter, paginate, click a row and verify preview pane content (INV-39: real components, observable behavior; no `mock.module` — scoped `spyOn` only, INV-48).
- `category.test.ts` — mime → category mapping covers each category and the `other` fallback.

## Verification

**Unit / integration**:

```
bun run test apps/backend/src/features/attachments
bun run test apps/frontend/src/components/attachment-explorer
bun run test packages/types
```

All must pass — no `.skip()` or `.todo()` (INV-26).

**E2E** (`bun run test:e2e`) — new spec covering:

1. Open from stream context menu → scope chip is pre-filled.
2. Open from quick links → no scope, shows workspace-wide most recent.
3. Open from quick switcher → same as quick links.
4. Apply `type:image` filter → list reduces; scroll to load more.
5. Click a PDF row → preview pane shows extract excerpt.
6. Click "Open in #stream" → navigates to the source message.
7. Share the URL with filters → reload reproduces the same view (INV-59 round-trip).
8. From a thread panel, open explorer → defaults to thread scope; "Include parent" banner expands to root.

**Manual smoke** (local dev):

- Upload a PDF, image, audio, code file across two streams + a thread.
- Open from the thread → confirm thread-only by default; "Include parent" expands.
- Search a quoted phrase that appears in the PDF extract → confirm it surfaces.
- Reload mid-session with filters in URL → confirm view restores.
- On mobile viewport — image tap goes straight to `MediaGallery`; PDF tap opens the drawer with extract.

## Out of scope (deferred)

- Size filtering (`min-size:` / `max-size:`) — not enough demand to justify.
- Bulk operations (multi-select, bulk delete, bulk move).
- AI-ranked semantic relevance — v1 sticks to FTS + filters; the pgvector embeddings infra exists if we want to layer it in later via `createAI` (INV-28, INV-19).
