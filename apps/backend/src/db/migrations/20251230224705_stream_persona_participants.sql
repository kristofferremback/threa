-- =============================================================================
-- Stream Persona Participants
-- Tracks when personas have sent messages in streams (participation, not config)
-- Enables "with:@persona" search to find streams where a persona has participated
-- =============================================================================

CREATE TABLE stream_persona_participants (
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    first_participated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, persona_id)
);

-- Find all streams where a persona has participated
CREATE INDEX idx_stream_persona_participants_persona ON stream_persona_participants (persona_id);

-- Find all personas that have participated in a stream
CREATE INDEX idx_stream_persona_participants_stream ON stream_persona_participants (stream_id);
