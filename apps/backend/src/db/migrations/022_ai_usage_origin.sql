-- Add origin column to ai_usage_records
--
-- Explicitly tags each AI call as 'system' or 'user' origin:
-- - system: Background jobs we control (classification, embedding, naming, etc.)
-- - user: User-initiated actions (companion responses)
--
-- This enables separate budget treatment:
-- - System usage: cost-controlled via engineering (prompt tuning, model selection)
-- - User usage: quota-controlled, user can adjust their model/prompt choices

ALTER TABLE ai_usage_records
ADD COLUMN origin TEXT NOT NULL DEFAULT 'system';

-- Index for filtering by origin
CREATE INDEX idx_ai_usage_origin ON ai_usage_records(origin, workspace_id, created_at DESC);
