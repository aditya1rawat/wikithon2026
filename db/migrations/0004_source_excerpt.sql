-- Cache a short excerpt of each source's normalized body so wiki pages can
-- render a citation excerpt even when Hydra's full_recall does not surface a
-- chunk for that specific source.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS body_excerpt TEXT;
