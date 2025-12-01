-- ============================================================================
-- Memo Categories - Archetypes for content classification
-- ============================================================================
-- Categories represent the fundamental nature of the content (what kind of
-- knowledge it is), distinct from topics (what it's about).

ALTER TABLE memos ADD COLUMN IF NOT EXISTS category TEXT;

-- Valid categories:
-- - announcement: company/team news, updates, launches
-- - decision: choices made, direction set, policies
-- - how-to: processes, procedures, explanations, guides
-- - insight: ideas, lessons learned, knowledge shares
-- - reference: links, resources, documentation pointers
-- - event: things that happened, incidents, milestones
-- - feedback: user feedback, reviews, external input

ALTER TABLE memos ADD CONSTRAINT memos_category_check
  CHECK (category IS NULL OR category IN (
    'announcement',
    'decision',
    'how-to',
    'insight',
    'reference',
    'event',
    'feedback'
  ));

-- Index for filtering by category
CREATE INDEX idx_memos_category ON memos(workspace_id, category)
  WHERE archived_at IS NULL AND category IS NOT NULL;

COMMENT ON COLUMN memos.category IS 'Content archetype: announcement, decision, how-to, insight, reference, event, feedback';
