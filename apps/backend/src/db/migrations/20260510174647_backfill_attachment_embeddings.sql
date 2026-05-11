-- =============================================================================
-- Backfill: enqueue summary-embedding jobs for existing attachment extractions
-- =============================================================================
--
-- Pairs with `20260510174136_attachment_extractions_embedding.sql`. Pre-existing
-- extractions never went through `AttachmentEmbeddingHandler`, so this migration
-- re-uses the queue table itself as the backfill mechanism — once committed the
-- normal `attachment.embed` worker drains the rows like any other job.
--
-- Re-enqueue pattern: future migrations can use the same shape (filtering by
-- whatever needs reprocessing — content_type, model version, time window) to
-- replay extractions without bespoke backfill scripts. Keep the WHERE clause
-- aligned with `isContentTypeEmbeddable()` in
-- `apps/backend/src/features/attachments/embedding-config.ts` so we don't queue
-- jobs the worker will immediately discard. The worker re-checks eligibility,
-- so the alignment is an optimisation not a correctness requirement.
--
-- ID shape `queue_<uuid hex>` follows the established migration-backfill
-- convention (see `20260428120000_attachment_references.sql`); production
-- enqueues use ULIDs via `queueId()` in code.

INSERT INTO queue_messages (
    id,
    queue_name,
    workspace_id,
    payload,
    process_after,
    inserted_at
)
SELECT
    'queue_' || replace(gen_random_uuid()::text, '-', ''),
    'attachment.embed',
    workspace_id,
    jsonb_build_object(
        'attachmentId', attachment_id,
        'workspaceId', workspace_id
    ),
    NOW(),
    NOW()
FROM attachment_extractions
WHERE summary_embedding IS NULL
  AND content_type NOT IN ('photo', 'other')
  AND length(trim(summary)) >= 10;
