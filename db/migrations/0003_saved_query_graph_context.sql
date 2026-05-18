-- Persist Hydra graph_context with each saved query so we can render the connections used.
ALTER TABLE saved_queries ADD COLUMN IF NOT EXISTS graph_context JSONB;
