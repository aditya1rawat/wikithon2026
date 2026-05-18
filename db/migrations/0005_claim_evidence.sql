-- Persist the exact sentence the LLM extracted each claim from so wiki pages
-- can render an evidence quote that actually matches the claim text, even when
-- Hydra's chunk recall surfaces a different passage.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS evidence_quote TEXT;
