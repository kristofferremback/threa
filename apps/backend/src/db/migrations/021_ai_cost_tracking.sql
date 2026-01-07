-- AI Cost Tracking Tables
--
-- Tracks AI usage costs from OpenRouter and enforces workspace budgets.
-- Cost is captured from OpenRouter's providerMetadata.openrouter.usage.cost
-- at the time of each AI call.

-- Individual usage records (append-only log)
-- Records every AI operation with its cost for aggregation and auditing
CREATE TABLE ai_usage_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,                              -- null for system/background jobs
  session_id TEXT,                           -- agent session if applicable
  function_id TEXT NOT NULL,                 -- "memo-classify", "companion-response", etc.
  model TEXT NOT NULL,                       -- "anthropic/claude-haiku-4.5", "openai/gpt-4o-mini"
  provider TEXT NOT NULL,                    -- "openrouter"
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(12, 8) NOT NULL,          -- from OpenRouter response
  metadata JSONB,                            -- extra context (stream_id, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_ai_usage_workspace_created ON ai_usage_records(workspace_id, created_at DESC);
CREATE INDEX idx_ai_usage_user_created ON ai_usage_records(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_ai_usage_function ON ai_usage_records(function_id, created_at DESC);
CREATE INDEX idx_ai_usage_model ON ai_usage_records(model, created_at DESC);

-- Workspace budget configuration
-- Default budget is $50/month for new workspaces
CREATE TABLE ai_budgets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  monthly_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
  alert_threshold_50 BOOLEAN NOT NULL DEFAULT true,
  alert_threshold_80 BOOLEAN NOT NULL DEFAULT true,
  alert_threshold_100 BOOLEAN NOT NULL DEFAULT true,
  degradation_enabled BOOLEAN NOT NULL DEFAULT true,   -- auto-downgrade models when over budget
  hard_limit_enabled BOOLEAN NOT NULL DEFAULT false,   -- block AI calls when way over budget
  hard_limit_percent INTEGER NOT NULL DEFAULT 150,     -- % of budget for hard limit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user quotas within a workspace (optional)
-- Allows workspace admins to limit per-user spending
CREATE TABLE ai_user_quotas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  monthly_quota_usd NUMERIC(10, 2),          -- null means no per-user limit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

-- Alert tracking to prevent duplicate notifications
-- Records when alerts are sent so we don't spam users
CREATE TABLE ai_alerts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,                              -- null for workspace-level alerts
  alert_type TEXT NOT NULL,                  -- 'budget_50', 'budget_80', 'budget_100', 'quota_exceeded'
  threshold_percent INTEGER NOT NULL,
  period_start DATE NOT NULL,                -- month start for deduplication
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one alert per workspace+user+type+period
-- Uses COALESCE to handle null user_id for workspace-level alerts
CREATE UNIQUE INDEX idx_ai_alerts_unique ON ai_alerts(workspace_id, COALESCE(user_id, ''), alert_type, period_start);

-- Index for checking existing alerts
CREATE INDEX idx_ai_alerts_workspace_period ON ai_alerts(workspace_id, period_start);
