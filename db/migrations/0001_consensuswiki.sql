CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hydra_sub_tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id),
  url TEXT,
  title TEXT,
  publisher TEXT,
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  hydra_status TEXT,
  workflow_run_id TEXT
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id),
  canonical_name TEXT NOT NULL,
  entity_type TEXT,
  hydra_entity_id TEXT,
  first_seen TIMESTAMPTZ DEFAULT now(),
  UNIQUE (topic_id, canonical_name)
);

CREATE TABLE entity_aliases (
  alias TEXT NOT NULL,
  entity_id TEXT REFERENCES entities(id),
  PRIMARY KEY (alias, entity_id)
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id),
  claim_text TEXT NOT NULL,
  stance TEXT NOT NULL,
  confidence REAL,
  chunk_uuid TEXT,
  extracted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX claims_entity_extracted_idx ON claims (entity_id, extracted_at DESC);

CREATE TABLE claim_relations (
  claim_a TEXT REFERENCES claims(id) ON DELETE CASCADE,
  claim_b TEXT REFERENCES claims(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  rationale TEXT,
  llm_confidence REAL,
  judged_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (claim_a, claim_b)
);

CREATE TABLE ledes (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id),
  lede TEXT NOT NULL,
  source_count_at_gen INT,
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE saved_queries (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id),
  question TEXT NOT NULL,
  answer_md TEXT NOT NULL,
  cited_source_ids TEXT[],
  saved_at TIMESTAMPTZ DEFAULT now()
);
