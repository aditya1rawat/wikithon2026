# ConsensusWiki — Design Spec

**Date:** 2026-05-16
**Project:** Wikithon 2026 submission
**Status:** Approved for implementation planning

## Summary

ConsensusWiki is a live, multi-source wiki for contested topics. Instead of hiding disagreement behind a single neutral narrative, it surfaces it: every entity page shows what is established, what is contested (with side-by-side citations), and what is single-sourced. Sources are ingested on demand from URLs or PDFs, indexed by HydraDB, and processed by an LLM pipeline that extracts atomic claims, judges contradictions pairwise, and rebuilds entity pages and a topic-wide entity graph.

The demo seed topic is **AI industry news** (model releases, leaks, benchmark disputes). The engine itself is topic-agnostic and uses HydraDB sub-tenants to isolate per-topic universes.

## Goals

1. **Demo magic.** Live ingest → wiki page reshapes → contradictions surface → graph grows in front of judges.
2. **Technical novelty.** Exploit HydraDB's knowledge graph (`chunk_relations`, `query_paths`), `recency_bias`, and sub-tenant isolation — features RAG-on-vector-DB demos don't have.
3. **Post-hackathon utility.** The shape (journalism, OSINT, research) is genuinely useful; engine reusable per topic.

## Non-goals (v1)

- User accounts / multi-user editing
- Manual claim/contradiction correction UI (admin override is stretch)
- Crawler / RSS pollers (stretch)
- Multi-LLM provider routing (stretch — OpenRouter wrapper)
- Bias scoring per publisher (stretch)

## Architecture

Three layers:

1. **Ingest layer.** Next.js server action accepts a URL or uploaded PDF, then hands off to a Vercel Workflow that owns the multi-step pipeline (fetch → normalize → upload to HydraDB → poll → claim-extract → contradiction-judge → cache invalidate).
2. **Storage layer.** HydraDB owns raw chunks, embeddings, the entity graph, and recall. Neon Postgres (via Vercel Marketplace) owns the derived application data: `topics`, `sources`, `entities`, `entity_aliases`, `claims`, `claim_relations`, `ledes`, `saved_queries`.
3. **Wiki layer.** Next.js 16 App Router with RSC + Cache Components. Routes:
   - `/` — topic dashboard + search
   - `/ingest` — paste URL or upload PDF
   - `/wiki/[entity]` — entity page
   - `/wiki/q/[slug]` — saved query/synthesis page
   - `/graph` — cytoscape view of topic entity graph
   - `/query` — ad-hoc question box that returns synthesized answers w/ citations and a "save as wiki page" action

### Tech stack

- Next.js 16 App Router (RSC, Cache Components with `cacheTag`/`cacheLife`)
- Vercel Workflow (WDK) for the ingest pipeline
- Vercel Functions (Fluid Compute) for LLM calls
- Neon Postgres via Vercel Marketplace
- Vercel Blob for uploaded PDFs
- Vercel Runtime Cache for short-TTL recall result caching
- HydraDB SDK for ingestion + recall (`/ingestion/upload_knowledge`, `/recall/full_recall`)
- NVIDIA NIM client behind a provider-agnostic `lib/llm.ts` (OpenRouter swap = stretch)
- shadcn/ui + Tailwind
- cytoscape.js for the graph view

### Why HydraDB earns its keep

- `chunk_relations` and `query_paths` feed the graph view directly — no separate graph DB.
- `recency_bias: 0.6` keeps entity pages fresh as new claims arrive.
- Sub-tenant per topic isolates universes cleanly and lets the engine scale to multi-topic without schema work.
- Built-in file ingestion handles PDFs (leaked decks, briefs — common in AI-industry coverage).

### LLM tasks (all via NIM in v1)

1. Entity canonicalization (`"Open AI"`, `"OpenAI"`, `"openai"` → same id)
2. Per-source claim extraction → atomic `{entity, claim, stance, confidence}`
3. Pairwise contradiction judging → `agree | contradict | qualify | unrelated` + rationale
4. Entity-page lede synthesis (cached, regenerated when source count grows by ≥3)
5. Query-time answer synthesis with inline citations

## Data model

### Postgres schema (Neon)

```sql
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hydra_sub_tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,              -- mirrors HydraDB source_id
  topic_id TEXT REFERENCES topics(id),
  url TEXT,
  title TEXT,
  publisher TEXT,
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  hydra_status TEXT,                -- queued|in_progress|success|errored
  workflow_run_id TEXT
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,              -- slug
  topic_id TEXT REFERENCES topics(id),
  canonical_name TEXT NOT NULL,
  entity_type TEXT,                 -- PERSON|ORG|PRODUCT|EVENT|MODEL
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
  id TEXT PRIMARY KEY,              -- sha256(source_id|claim_text)
  source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id),
  claim_text TEXT NOT NULL,
  stance TEXT NOT NULL,             -- factual|opinion|prediction|leak|rumor
  confidence REAL,
  chunk_uuid TEXT,                  -- backref to HydraDB chunk for citation
  extracted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON claims (entity_id, extracted_at DESC);

CREATE TABLE claim_relations (
  claim_a TEXT REFERENCES claims(id) ON DELETE CASCADE,
  claim_b TEXT REFERENCES claims(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,           -- agree|contradict|qualify|unrelated
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
```

### HydraDB usage

- One `app_knowledge` POST per source. Body:
  - `tenant_id` = workspace tenant
  - `sub_tenant_id` = `topic.hydra_sub_tenant_id`
  - `id` = `source.id`
  - `source` = publisher (e.g. `"techcrunch"`)
  - `title`, `url`, `timestamp` = `published_at`
  - `content.text` = article body
  - `additional_metadata` = `{ topic_id, ingest_run_id }`
- Recall (entity page): `full_recall` with `mode: thinking`, `graph_context: true`, `recency_bias: 0.6`, `alpha: 0.8`, `query` = `<canonical_name> recent claims context`. (`recall_preferences` is reserved for memory; v1 stores everything as knowledge.)
- Recall (graph view): one broad `full_recall` per topic; harvest `graph_context.chunk_relations.triplets` into nodes/edges.
- Caching: results keyed by `(query_hash, sub_tenant)` in Vercel Runtime Cache, 5-minute TTL.

## Data flow

### Workflow pipeline

```
Step 1: fetchAndNormalize
  inputs: { url | pdf_blob_url, topic_id }
  - URL: fetch HTML → Readability extract
  - PDF: download from Blob → pdf-parse
  - extract { title, publisher, published_at, body_text }
  - insert sources row (status=queued)
  outputs: { source_id, body_text, metadata }

Step 2: hydraUpload
  - POST /ingestion/upload_knowledge with app_knowledge object
  - persist hydra_status=queued
  outputs: { hydra_source_id }

Step 3: pollHydraStatus
  - poll until status in {success,errored}
  - 90s ceiling; retry once on transient errors
  outputs: { final_status }

Step 4: extractClaims
  - NIM prompt: body_text + few-shot, structured JSON output
  - canonicalize entities (lookup aliases, insert new entities)
  - insert claims rows; backfill chunk_uuid via HydraDB recall on claim_text
  outputs: { claim_ids }

Step 5: judgeContradictions
  - for each new claim c:
      fetch top 10 existing claims for same entity by recency
      pairwise NIM prompt → { relation, rationale, confidence }
      insert claim_relations rows
  outputs: { relation_count }

Step 6: invalidateCache
  - revalidateTag(`entity:${id}`) for each touched entity
  - revalidateTag(`topic:${topic_id}`)
  - revalidateTag(`graph:${topic_id}`)
```

### Cache tags

- `topic:<id>` — topic dashboard
- `entity:<id>` — entity page
- `graph:<topic_id>` — cytoscape JSON payload
- `lede:<entity_id>` — regenerate when source count grows by ≥3 since `source_count_at_gen`
- `cacheLife: "hours"` for entity pages

### Entity page render (`/wiki/[entity]`)

1. Server component reads from Postgres: `entities`, `claims` joined to `sources`, `claim_relations`, `ledes`.
2. In parallel: HydraDB `full_recall` query for the entity → raw quotes/chunks for inline excerpts.
3. Group claims into three buckets:
   - **Established** — ≥2 sources, zero `claim_relations` with `relation='contradict'`
   - **Contested** — appears in ≥1 `contradict` row; render side-by-side with both sources and LLM rationale
   - **Single-source** — exactly 1 supporting source, no contradictions
4. Build timeline from `sources.published_at`.
5. Render related-entities mini-graph from `claim_relations` joins.

### Entity canonicalization

- First mention: NIM normalizes raw entity string, check `entity_aliases`, insert into `entities` if new.
- Batched per Workflow run (one canonicalization call covers all extracted entities — cheaper than per-claim).
- Stretch: `/admin/entities/[id]` merge UI for manual fixups.

## Error handling

### Ingest pipeline

- **fetchAndNormalize.** 4xx → mark source `failed_fetch`; surface in `/ingest` log. 5xx + network → Workflow retry (3x, exponential backoff). Paywall or JS-rendered sites → fallback to `r.jina.ai/<url>` proxy reader.
- **hydraUpload.** Timeout (`writeTimeoutMs=15s`) → retry once. Persistent 5xx → `failed_upload`; manual retry button in UI.
- **pollHydraStatus.** 90s ceiling. On `errored`, mark source `hydra_errored` and skip downstream; keep row visible for debugging.
- **extractClaims.** NIM timeout/5xx → retry 2x. JSON parse failure → re-prompt with stricter "JSON only" instruction. Final failure → log raw response, surface in UI.
- **judgeContradictions.** Per-pair failures isolated; one bad pair doesn't kill the step. Pairwise cap at 10×N per new-claim batch.
- **invalidateCache.** Best-effort; failures logged, page goes stale ~10 min worst case.

### LLM safeguards

- All NIM calls use a Zod-validated structured output schema; reject + retry on schema miss.
- Per-call timeout 20s; circuit breaker pauses Workflow after 5 consecutive failures and surfaces a banner.
- Per-source input cap (~12k tokens). Long articles truncated to first N + last N paragraphs.
- `lib/llm.ts` exposes `complete()`, `extract()`, `judge()`. NIM is the default impl; OpenRouter wrapper added behind an env flag in the stretch milestone.

### Data integrity

- All inserts idempotent on stable IDs:
  - `source.id` = `sha256(topic_id|url)`
  - `claim.id` = `sha256(source_id|claim_text)`
- Workflow re-runs on the same source skip via `ON CONFLICT DO NOTHING`.
- Contradiction judgments retain history via `judged_at` (rejudging on new evidence does not erase old rows).

### HydraDB rate limits

- Track in-flight ingests; cap at 5 concurrent. Excess queued via a `pending_ingests` row + cron sweep.
- Recall calls cached `(query_hash, sub_tenant)` in Vercel Runtime Cache for 5 minutes.

### Frontend

- `<Suspense>` boundaries per entity-page section with skeletons.
- Empty states: "No contested claims yet — ingest more sources."
- Graph view degrades to a related-entities table if cytoscape fails to mount.
- `useOptimistic` accepts the ingest URL immediately; polling updates real status.

### Demo-day risks

- WiFi flaky → local mirror of demo seed; env var bypasses live fetch.
- NIM cold start → warm via ping in `instrumentation.ts`.
- HydraDB processing slow → 8 articles pre-ingested in the demo sub-tenant before stage.
- Vercel cold start → keep dev server hot via visible-tab ping; screen-record fallback ready.

## Testing

### Unit (Vitest)

- `extractClaims` prompt → snapshot tests on 5 canned articles (launch, response, leak, ablation paper, opinion).
- `judgeContradictions` → fixture claim pairs with expected relation labels.
- `canonicalizeEntities` → variants of `"GPT-5"`, `"gpt5"`, `"GPT 5"` → same id.
- Postgres model functions → run against `pglite` in-memory.

### Integration

- HydraDB and NIM mocked via MSW. Full Workflow pipeline on a canned article URL; assert `claims` and `claim_relations` rows correct and cache tags invalidated.
- Real-HydraDB integration test behind `INTEGRATION=1` env, run pre-demo only.

### E2E (Playwright)

- One happy path: `/ingest` → paste seed URL → wait for entity page → assert lede + ≥1 claim rendered + citation link works.

### Manual demo rehearsal

- 8 seed URLs pre-ingested in the demo sub-tenant with known contradictions.
- Entity pages exist for: GPT-5, OpenAI, Sam Altman, Anthropic, Claude 4.7.
- `/graph` renders ≥20 nodes with at least one red (contradict) edge.
- `/query` returns a side-by-side answer for "what's contested about GPT-5 release date?".
- "Save as wiki page" creates `/wiki/q/<slug>`.

## Demo script (3 minutes)

1. **(0:00)** Open `/`. "ConsensusWiki: a Wikipedia for contested facts." Topic dashboard for *AI industry*: 8 entities, 23 claims, 7 contradictions.
2. **(0:20)** Click **GPT-5**. Show **Established**, **Contested** (release date dispute side-by-side), **Timeline**, related-entities mini-graph.
3. **(1:00)** Open `/graph`. Cytoscape view. Red edges = disputes, green = confirms. Pan, zoom.
4. **(1:30)** Back to `/ingest`. Paste a fresh URL live (pre-tested). Show Workflow progress. ~30s later refresh GPT-5 → new claim appears in Contested with a new red edge in the graph.
5. **(2:15)** `/query`: "what's the consensus on GPT-5 benchmarks?" → synthesized answer with inline citations and a "Disagreement noted" callout. Click *Save as wiki page* → page now lives at `/wiki/q/gpt5-benchmarks`.
6. **(2:50)** Close on stretch goals: RSS feeds, OpenRouter fallback, per-publisher bias scoring.

## Milestones

1. **M1 — Skeleton + ingest happy path.** Next.js scaffold, Neon hookup, HydraDB client, Vercel Workflow with steps 1–3, `/ingest` page, sources list.
2. **M2 — Claim extraction + entity pages.** NIM client, `extractClaims` step, `canonicalizeEntities`, `/wiki/[entity]` with claims grouped (no contradictions yet).
3. **M3 — Contradiction surfacing.** `judgeContradictions` step, claim grouping into Established/Contested/Single-source, side-by-side render.
4. **M4 — Graph view + query.** `/graph` cytoscape page, `/query` synthesis, "save as wiki page".
5. **M5 — Lede synthesis + cache tags + polish.** Lede regen heuristic, full cache invalidation, empty/error states, demo seed.
6. **Stretch.** RSS poller, OpenRouter wrapper behind env flag, publisher-bias chip on cited sources, admin entity-merge UI.

## Open questions

- Tenant naming convention: single tenant + topic-keyed sub_tenants confirmed; sub_tenant id format = `wikithon-<topic-id>`.
- NIM model choice: default to a Nemotron-class chat model with structured output; revisit if extraction quality is poor.
- PDF support: in v1, accept PDF uploads but defer OCR'd scans to stretch.
