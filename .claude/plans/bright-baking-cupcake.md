# Video Carousel Support

## Context

Users can upload video files, but they're treated as generic file downloads — no inline playback, no thumbnails, no integration with the image carousel. This plan adds end-to-end video support: accepting uploads up to 100MB, transcoding via AWS MediaConvert to H.264 MP4 + thumbnail extraction, and displaying playable videos alongside images in the gallery.

---

## 1. Database Migration

**New file:** `apps/backend/src/db/migrations/YYYYMMDDHHMMSS_video_transcode_jobs.sql`

Create a `video_transcode_jobs` tracking table (INV-57 — transient workflow state in tracking table, not on core entities):

```sql
CREATE TABLE video_transcode_jobs (
    id TEXT PRIMARY KEY,
    attachment_id TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    mediaconvert_job_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | submitted | completed | failed
    processed_storage_path TEXT,
    thumbnail_storage_path TEXT,
    error_message TEXT,
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_video_transcode_jobs_attachment ON video_transcode_jobs (attachment_id);
CREATE INDEX idx_video_transcode_jobs_active
    ON video_transcode_jobs (status, created_at)
    WHERE status NOT IN ('completed', 'failed');
```

No FK (INV-1), TEXT for status (INV-3), prefixed ULID for id (INV-2).

---

## 2. Shared Types & Constants

### `packages/types/src/constants.ts`
- Add `VIDEO_TRANSCODE_STATUSES = ["pending", "submitted", "completed", "failed"] as const`
- Add `VideoTranscodeStatus` type

### `packages/types/src/domain.ts`
- Extend `AttachmentSummary` with optional `processingStatus?: ProcessingStatus` field (backward-compatible; only populated for video attachments so frontend knows if transcoding is in progress)

### `packages/backend-common` (id generators)
- Add `videoTranscodeJobId()` → `vidjob_<ulid>` (INV-2)

---

## 3. Infrastructure

### `infra/aws/main.tf`
- Add IAM role `threa-mediaconvert-{env}` for MediaConvert to assume (needs S3 read/write on uploads bucket)
- Add IAM policy on backend user for `mediaconvert:CreateJob`, `mediaconvert:GetJob`, `mediaconvert:DescribeEndpoints`
- Output the MediaConvert role ARN

### `apps/backend/src/lib/env.ts`
- Add `MediaConvertConfig` interface: `{ roleArn, endpoint?, enabled }`
- Add `mediaConvert` to `Config`
- Load from env vars: `MEDIACONVERT_ROLE_ARN`, `MEDIACONVERT_ENDPOINT`, `MEDIACONVERT_ENABLED`

### `apps/backend/src/middleware/upload.ts`
- Increase `MAX_FILE_SIZE` from 50MB to 100MB

---

## 4. Backend Video Feature Module

All files in `apps/backend/src/features/attachments/video/` (INV-51).

### 4.1 `config.ts` — Video detection utility
- `isVideoAttachment(mimeType, filename)`: returns true for `video/*` MIME types or known video extensions (`.3g2`, `.3gp`, `.asf`, `.avi`, `.f4v`, `.flv`, `.mkv`, `.mov`, `.mp4`, `.mpeg`, `.mpg`, `.mxf`, `.webm`, `.wmv`)
- `VIDEO_EXTENSIONS` constant

### 4.2 `job-repository.ts` — `VideoTranscodeJobRepository`
- `insert(client, params)` — create tracking row
- `findByAttachmentId(client, attachmentId)` — single lookup
- `findByAttachmentIds(client, attachmentIds)` — batch lookup (for enriching message attachment summaries)
- `updateSubmitted(client, id, mediaconvertJobId)` — set job ID + status to `submitted`
- `updateCompleted(client, id, processedPath, thumbnailPath)` — set paths + status to `completed`
- `updateFailed(client, id, errorMessage)` — set error + status to `failed`

### 4.3 `mediaconvert-client.ts` — AWS MediaConvert wrapper
- Constructed once with credentials (INV-13)
- `discoverEndpoint()` — calls `DescribeEndpoints`, caches the per-account endpoint
- `submitTranscodeJob({ s3InputKey, s3OutputPrefix, bucket, roleArn })` — creates job with:
  - Output 1: H.264 MP4, AAC audio, reasonable quality
  - Output 2: Frame capture at 1s mark → single JPEG thumbnail
  - Output paths: `{ws}/{attachmentId}/processed.mp4` and `{ws}/{attachmentId}/thumbnail.0000001.jpg`
- `getJobStatus(jobId)` — returns `{ status: 'SUBMITTED'|'PROGRESSING'|'COMPLETE'|'ERROR', errorMessage? }`

### 4.4 `service.ts` — `VideoTranscodingService`

**Dependencies:** `{ pool, mediaConvertClient, storage, s3Config }`

**`submit(attachmentId)`:**
1. Fetch attachment from DB, release connection
2. Atomically transition to PROCESSING (INV-20)
3. Insert `video_transcode_jobs` row with status `pending`
4. Call MediaConvert API (no DB connection held — INV-41)
5. Update tracking row to `submitted` with MediaConvert job ID

**`checkStatus(attachmentId)`** → `boolean` (true = done):
1. Fetch tracking job from DB, release connection
2. Call MediaConvert `getJobStatus` (no DB held — INV-41)
3. If COMPLETE: update tracking row to `completed` with paths, update attachment to COMPLETED, return true
4. If ERROR: update tracking row to `failed`, update attachment to FAILED, return true
5. If still in progress: return false

**`getVideoInfo(attachmentId)`** → `{ processedStoragePath, thumbnailStoragePath } | null`:
- Fetch tracking job, return paths if completed

### 4.5 `service.stub.ts` — `StubVideoTranscodingService`
- `submit()`: immediately marks attachment SKIPPED (no MediaConvert in dev/test)
- `checkStatus()`: returns true
- Used when `config.mediaConvert.enabled === false`

### 4.6 `submit-worker.ts`
Thin worker (INV-34):
```ts
export function createVideoTranscodeSubmitWorker(deps): JobHandler<VideoTranscodeSubmitJobData> {
  return async (job) => {
    await deps.videoTranscodingService.submit(job.data.attachmentId)
    await deps.jobQueue.send(JobQueues.VIDEO_TRANSCODE_CHECK, {
      attachmentId: job.data.attachmentId,
      workspaceId: job.data.workspaceId,
    }, { processAfter: new Date(Date.now() + 10_000) })
  }
}
```

### 4.7 `check-worker.ts`
Re-enqueue pattern (avoids holding queue token during transcode):
```ts
export function createVideoTranscodeCheckWorker(deps): JobHandler<VideoTranscodeCheckJobData> {
  return async (job) => {
    const done = await deps.videoTranscodingService.checkStatus(job.data.attachmentId)
    if (!done) {
      await deps.jobQueue.send(JobQueues.VIDEO_TRANSCODE_CHECK, {
        attachmentId: job.data.attachmentId,
        workspaceId: job.data.workspaceId,
      }, { processAfter: new Date(Date.now() + 10_000) })
    }
  }
}
```

Add a max-age safety check: if the tracking job was created > 30 minutes ago, fail it rather than re-enqueue indefinitely.

### 4.8 `index.ts` — barrel exports
Export service, stub, workers, config, repository (INV-52).

---

## 5. Queue Integration

### `apps/backend/src/lib/queue/job-queue.ts`
- Add `VIDEO_TRANSCODE_SUBMIT: "video.transcode_submit"` and `VIDEO_TRANSCODE_CHECK: "video.transcode_check"` to `JobQueues`
- Add `VideoTranscodeSubmitJobData { attachmentId, workspaceId, filename, storagePath }`
- Add `VideoTranscodeCheckJobData { attachmentId, workspaceId }`
- Add both to `JobDataMap`

### `apps/backend/src/features/attachments/uploaded-outbox-handler.ts`
- Import `isVideoAttachment` from `./video`
- Add case before the default text-processing fallthrough:
  ```ts
  case isVideoAttachment(mimeType, filename):
    await this.jobQueue.send(JobQueues.VIDEO_TRANSCODE_SUBMIT, { attachmentId, workspaceId, filename, storagePath })
    break
  ```

### `apps/backend/src/server.ts`
- Construct `VideoTranscodingService` (or stub based on config)
- Create workers via factory functions
- Register both on `QueueTiers.HEAVY`, `QueueFairness.NONE`
- DLQ hook: mark attachment as FAILED + tracking job as `failed`

---

## 6. Backend API Extensions

### `apps/backend/src/features/attachments/handlers.ts` — `getDownloadUrl`
- Add `variant` query param: `z.enum(["raw", "processed", "thumbnail"]).optional()`
- Default (no variant or `raw`): existing behavior (presigned URL for original upload)
- `processed`: look up `video_transcode_jobs` for this attachment, return presigned URL for `processed_storage_path`
- `thumbnail`: return presigned URL for `thumbnail_storage_path`
- If variant requested but job not completed, fall back to raw

### `apps/backend/src/features/messaging/event-service.ts` — `AttachmentSummary`
- Add `processingStatus` to the `AttachmentSummary` interface
- When building summaries in `createMessage`, include `processingStatus` from the attachment record
- This lets the frontend know a video is still transcoding without needing a separate API call

### Outbox event for transcode completion (real-time push via socket)
- Add `attachment:transcoded` event type in `apps/backend/src/lib/outbox/repository.ts`
- Make it stream-scoped when the attachment has a `streamId` (typical case — user sends message before transcode finishes), workspace-scoped otherwise
- Payload: `{ workspaceId, streamId?, attachmentId, processingStatus, thumbnailStoragePath?, processedStoragePath? }`
- Emit from `VideoTranscodingService.checkStatus()` when transcoding completes (or fails)
- The existing `BroadcastHandler` automatically routes it to the correct socket room
- Frontend socket handler updates the local attachment store so the UI re-renders with thumbnail + playable state

---

## 7. Frontend

### 7.1 `apps/frontend/src/api/attachments.ts`
- Extend `getDownloadUrl` to accept optional `variant?: "raw" | "processed" | "thumbnail"` parameter
- Append `?variant=...` to the API URL
- Separate cache keys per variant

### 7.2 `apps/frontend/src/components/timeline/attachment-list.tsx`
- Add `videoAttachments` bucket: `mimeType.startsWith("video/")`
- Update `fileAttachments` to exclude `video/*`
- Add `VideoAttachment` component:
  - Fetches thumbnail URL via `getDownloadUrl(workspaceId, id, { variant: "thumbnail" })`
  - Shows thumbnail with play icon overlay
  - If `processingStatus === "pending" | "processing"`: show spinner overlay with "Processing..."
  - If `processingStatus === "failed"`: render as `FileAttachment` with error indicator (not in carousel)
  - On click: opens media gallery at this item
- Combine images + completed videos into unified `galleryItems` for the gallery

### 7.3 `apps/frontend/src/components/image-gallery.tsx` → `media-gallery.tsx`
- Rename component to `MediaGallery` (keep `ImageGallery` re-export for transition, then clean up per INV-49)
- Change `GalleryImage` to discriminated union `GalleryItem`:
  ```ts
  export type GalleryItem =
    | { type: "image"; url: string; filename: string; attachmentId: string }
    | { type: "video"; url: string; thumbnailUrl: string; filename: string; attachmentId: string }
  ```
- Main display area: conditionally render `<img>` for images, `<video>` for videos
- Video element: native HTML5 `<video>` with `controls`, `controlsList`, poster set to `thumbnailUrl`
- Action bar for videos:
  - Download dropdown (using Shadcn DropdownMenu): "Download original" vs "Download processed"
  - Remove Copy button (not applicable to video)
- Thumbnail panel: videos show thumbnail with small play icon overlay

### 7.4 `apps/frontend/src/lib/markdown/attachment-context.tsx`
- Update `openAttachment` to handle video MIME types — fetch processed video URL and open gallery

### 7.5 Socket handler for `attachment:transcoded`
- In the existing socket event handler (where other outbox events are consumed), add handling for `attachment:transcoded`
- On receipt: update the attachment's `processingStatus` in the local query cache (TanStack Query)
- For completed videos: the next time the VideoAttachment renders, it fetches the thumbnail URL on demand
- For failed videos: the component re-renders showing the file-download fallback with error indicator

---

## 8. Key Files to Modify

| File | Change |
|------|--------|
| `apps/backend/src/db/migrations/new` | New migration for `video_transcode_jobs` |
| `packages/types/src/constants.ts` | Video transcode status constants |
| `packages/types/src/domain.ts` | Extend `AttachmentSummary` |
| `packages/backend-common/src/id.ts` | Add `videoTranscodeJobId` |
| `infra/aws/main.tf` | MediaConvert IAM role + backend permissions |
| `apps/backend/src/lib/env.ts` | MediaConvert config |
| `apps/backend/src/middleware/upload.ts` | Increase file size limit to 100MB |
| `apps/backend/src/lib/queue/job-queue.ts` | New queue definitions |
| `apps/backend/src/features/attachments/video/*` | New feature module (7-8 files) |
| `apps/backend/src/features/attachments/index.ts` | Re-export video module |
| `apps/backend/src/features/attachments/uploaded-outbox-handler.ts` | Route videos to new queue |
| `apps/backend/src/lib/outbox/repository.ts` | Add `attachment:transcoded` event type |
| `apps/backend/src/features/attachments/handlers.ts` | Add `variant` param to download URL |
| `apps/backend/src/features/messaging/event-service.ts` | Include `processingStatus` in summary |
| `apps/backend/src/server.ts` | Wire up video service + workers |
| `apps/frontend/src/api/attachments.ts` | Add `variant` support |
| `apps/frontend/src/components/image-gallery.tsx` | Generalize to MediaGallery |
| `apps/frontend/src/components/timeline/attachment-list.tsx` | Add video rendering |
| `apps/frontend/src/lib/markdown/attachment-context.tsx` | Handle video clicks |
| `apps/frontend/src/` (socket handler) | Handle `attachment:transcoded` event |

---

## 9. Implementation Order

1. **Types + Migration** — foundation with no runtime changes
2. **Infrastructure** — Terraform IAM + env config + file size limit
3. **Backend video module** — repository, MediaConvert client, service, stub
4. **Queue integration** — job types, workers, routing, server.ts wiring
5. **Backend API extensions** — download URL variants, outbox event, event-service enrichment
6. **Frontend** — API variant support, video attachment component, media gallery, socket handler

---

## 10. Verification

1. **Unit tests:** Video detection (`isVideoAttachment`), repository CRUD, service logic (with stub MediaConvert client)
2. **Integration test:** Upload a video → verify job created → simulate MediaConvert completion → verify attachment marked COMPLETED with paths
3. **E2E:** Upload a video file → see processing indicator → after completion, click to open gallery → verify video plays with controls → test download dropdown (raw vs processed)
4. **Edge cases:** Failed transcode shows as file download with error indicator; oversized file (>100MB) rejected at upload; non-video files still route correctly
5. **Existing tests:** Run `bun run test` and `bun run test:e2e` to verify no regressions in image/file attachment flows
