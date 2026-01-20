-- Add composite index for efficient user usage queries
-- Used by AIUsageRepository.getUserUsage and getUsageByUser
CREATE INDEX idx_ai_usage_workspace_user_created
ON ai_usage_records(workspace_id, user_id, created_at DESC);

-- Add CHECK constraint to ensure origin values are valid
-- Complements application-level validation
ALTER TABLE ai_usage_records
ADD CONSTRAINT chk_ai_usage_origin CHECK (origin IN ('system', 'user'));
