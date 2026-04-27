-- Follow-up for `agent_config_overrides`:
-- - Drop a redundant partial index (the table already has UNIQUE (workspace_id, agent_id))
-- - Keep `updated_at` fresh on UPDATE (mirrors other tables that maintain this column in-app)

DROP INDEX IF EXISTS idx_agent_config_overrides_workspace_active;

CREATE OR REPLACE FUNCTION set_agent_config_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_config_overrides_set_updated_at ON agent_config_overrides;

CREATE TRIGGER trg_agent_config_overrides_set_updated_at
BEFORE UPDATE ON agent_config_overrides
FOR EACH ROW
EXECUTE FUNCTION set_agent_config_overrides_updated_at();
