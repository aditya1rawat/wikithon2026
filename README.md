# ConsensusWiki

> A live wiki for contested facts. Instead of hiding disagreement behind a single neutral narrative, it surfaces it.

**Wikithon 2026 submission · AI industry knowledge graph**

Most wikis flatten the web into one voice. ConsensusWiki keeps every source's voice intact and shows you exactly where they agree, where they collide, and where a claim is standing alone. Every claim is cited, every contradiction is rendered side-by-side with an LLM-judged rationale, and every entity has a live knowledge graph that grows as you ingest more sources.

---

## TL;DR

| | |
|---|---|
| **What it is** | A real-time, multi-source wiki that highlights disagreement instead of erasing it. |
| **Demo topic** | AI industry news (model releases, funding rumors, benchmark disputes). |
| **How it works** | URL → fetched + normalized → HydraDB indexes + builds a knowledge graph → NVIDIA NIM extracts atomic claims → pairwise contradiction judgement → Postgres derives the structured wiki view. |
| **Why HydraDB earns its keep** | We use `graph_context.query_paths`, `chunk_relations`, sub-tenant isolation, `recency_bias`, and signed webhooks — features RAG-on-vector-DB demos don't have. The knowledge graph is read directly from Hydra; we don't run a separate graph DB. |
| **Routes** | `/` dashboard · `/ingest` paste a URL · `/wiki/[entity]` entity page · `/graph` topic graph · `/query` ask the wiki · `/wiki/q/[slug]` saved query with numbered citations + Connections-Used view. |
| **Stack** | Next.js 16 App Router (RSC + Cache Components), Vercel (Functions + Webhooks), Neon Postgres, HydraDB, NVIDIA NIM (Llama-3.1), Tailwind v4, shadcn/ui, cytoscape. |

---

## The pitch (60 seconds)

Wikipedia gives you a single agreed-upon truth. The web gives you ten contradictory ones. Most AI tools paper over that gap — they pick a narrative or hedge so heavily nothing useful comes out. **ConsensusWiki keeps the disagreement.**

Ingest a TechCrunch article. The pipeline extracts atomic claims, finds every other claim about the same entity, and asks an LLM: *do these agree, contradict, qualify, or stand alone?* The entity page reshapes itself: **Established** (multiple sources align), **Contested** (sources collide, shown side-by-side with rationale), and **Single-source** (one outlier waiting for corroboration). The topic graph grows — red edges mean dispute, green means corroboration, dashed means a source mentioning an entity.

Ask the query box a question. The answer comes back with inline numbered citations and a **Connections Used** sub-graph showing exactly which entities and relations from HydraDB informed it. Click any number, it scrolls to the source.

That's the loop. Everything else is plumbing.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js 16 RSC + Cache Components)                       │
│  /  /ingest  /wiki/[entity]  /wiki/q/[slug]  /graph  /query        │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ Server Actions
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Ingest Workflow  (src/lib/ingest-workflow.ts)                     │
│  fetch + normalize → Hydra upload → poll → extract claims          │
│  → canonicalize entities → judge contradictions → lede synthesis    │
│  → revalidate cache tags                                            │
└──────┬─────────────────────────┬──────────────────────────┬─────────┘
       │                         │                          │
       ▼                         ▼                          ▼
┌─────────────┐         ┌─────────────────┐        ┌─────────────────┐
│  HydraDB    │         │  NVIDIA NIM     │        │  Neon Postgres  │
│  - upload   │         │  - extract      │        │  - sources      │
│  - recall   │◀────────│  - canonicalize │───────▶│  - entities     │
│  - graph    │         │  - judge        │        │  - claims       │
│    context  │         │  - lede         │        │  - relations    │
│  - webhook  │────────▶│  - query        │        │  - saved_queries│
│    →status  │         │    synthesis    │        │    (graph_ctx)  │
└─────────────┘         └─────────────────┘        └─────────────────┘
       │                                                    ▲
       │  POST /api/webhooks/hydra (HMAC-signed)            │
       └────────────────────────────────────────────────────┘
                   indexing.status_changed → updateSourceStatus()
```

### Layer responsibilities

- **HydraDB** — raw chunks, embeddings, knowledge graph (entity-relation triplets), full recall. Source of truth for chunk excerpts + multi-hop graph paths.
- **NVIDIA NIM** — all LLM work behind `src/lib/llm.ts`: claim extraction, entity canonicalization (with model-family alias generation), pairwise contradiction judgement, entity lede synthesis, query answer synthesis with inline citations.
- **Neon Postgres** — derived application data (sources, entities, aliases, claims, claim_relations, ledes, saved_queries with persisted graph_context). Stable SHA-256 ids make every write idempotent.
- **Vercel** — Functions for the ingest workflow + webhook receiver. Cache Components with `cacheTag`/`cacheLife`. Webhook tunnel via ngrok during the hackathon.

### Why HydraDB carries the demo

Four Hydra features make this app possible:

1. **`graph_context.query_paths` + `chunk_relations`** return knowledge-graph triplets at query time. We pipe these directly into the Connections-Used graph on `/wiki/q/[slug]` — no separate graph database, no manual entity extraction at recall time.
2. **Sub-tenant isolation** (`sub_tenant_id = wikithon-<topic-id>`) gives us per-topic universes for free. Adding a second topic is a one-line change.
3. **`recency_bias: 0.6`** keeps entity pages fresh as new sources arrive without us building any decay logic.
4. **Webhooks** (`indexing.status_changed`) flip our `hydra_status` column the instant a file finishes indexing. No polling cron, no stale UI.

Plus: **chunk-level citations**. When the entity page renders, we call `recallEntityContext(canonicalName)`, map returned chunks back to their source rows, and inline the actual quoted excerpt next to each claim. Real "press → highlight in the source" UX without any extra storage.

---

## The ingest pipeline in detail

`src/lib/ingest-workflow.ts:runIngestWorkflow`

| Step | What | Failure mode |
|------|------|--------------|
| 1. `fetchAndNormalize` | `fetch()` with realistic Chrome UA + 15s AbortController. Readability extract. Falls back to `r.jina.ai` proxy on 403/429/5xx or network error. | `workflow_status = failed_fetch` |
| 2. `hydraUpload` | Multipart POST `/ingestion/upload_knowledge` with `tenant_id`, `sub_tenant_id`, `app_knowledge[{...}]`. Idempotent via stable `source.id = sha256(topic\|url)`. | `workflow_status = failed_upload` |
| 3. `pollHydraStatus` | 10s ceiling. Hydra failure no longer blocks local pipeline (log + continue). Background webhook will flip `hydra_status` later. | `hydra_status = errored`, workflow proceeds |
| 4. `extractClaimsStep` | NIM JSON-mode prompt → Zod-validated `ClaimExtractionSchema`. Subjectless sentences in the deterministic fallback get the inferred entity prefixed (`"released GPT-5.5..."` → `"GPT-5.5 released..."`). | Falls back to regex-based extractor |
| 5. `canonicalizeEntities` | Batch NIM call returning `{raw, canonicalName, entityType, aliases[]}`. Deterministic GPT-N family-alias generation in the fallback path so `/wiki/gpt-5` resolves to the GPT-5.5 Instant entity without any manual DB row. | Per-entity normalization heuristics |
| 6. `judgeContradictionsStep` | For each new claim, fetch the entity's existing claims, pairwise NIM judgement → `agree \| contradict \| qualify \| unrelated` with rationale + confidence. Internal-fallback rationales are filtered out at render time so users never see "fallback used" copy. | Per-pair failure isolated; one bad pair doesn't kill the step |
| 7. `synthesizeLedesStep` | One NIM call per touched entity, throttled 750ms between calls. Circuit-breaks on first 429 to avoid burning quota across remaining entities. | Per-entity errors swallowed with `console.warn` |
| 8. `invalidateCacheStep` | `revalidateTag('entity:<id>', 'max')`, `revalidateTag('topic:<id>')`, `revalidateTag('graph:<topic>')`, `revalidatePath('/ingest')`. | Best-effort; pages go stale at most until next request |

Throughout: `safeUpdateWorkflowStatus` records `pending → extracting → judging → complete` so the `/ingest` dashboard shows real progress. `safeUpdateHydraStatus` writes the Hydra side independently — the two columns are decoupled.

### Status model

Two orthogonal state machines per source:

```
workflow_status:  pending → extracting → judging → complete
                  └→ failed_fetch / failed_upload
hydra_status:     queued → in_progress → success / errored / unknown
```

Hydra being slow no longer blocks the local pipeline. The UI surfaces both as separate pills with distinct treatments. Stale `pending` sources (>5 min) get a "Force retry" affordance. Webhook updates flip `hydra_status` in real time without page reloads needed.

---

## Routes

Each route is a deliberate slice of the workflow. The order below mirrors the natural usage flow: ingest sources → explore an entity → see the topic graph → ask a question → revisit a saved answer.

### `/` — Dashboard

**Purpose.** Single-glance read on the corpus. Tells you how rich the topic universe is right now and where the disagreement lives.

**What you see.**
- Big headline and color-coded CTAs into `/ingest` and `/graph`.
- **Topic stats** card on the right: entity count, claim count, source count, plus a destructive-tinted **Contradictions** row counting deduped contradict *pairs* (not relations — one disputed claim no longer inflates the number).
- Three explainer cards: **Established · Contested · Single-source** — these are the buckets every entity page uses.
- **Entities list** — top 12 entities ranked by `claimCount + contestedCount × 3`. The ranking heuristic pushes the most-debated entities to the top. Each row is a link → `/wiki/[entity]`. Red badge on the right shows contested-claim count when > 0.
- **Recent sources** — last 6 ingested URLs with the shared `<StatusPill>` showing both workflow and Hydra status.

**How to use it.**
- Land here first. Pick an entity that has a contested badge to see the most interesting page.
- Watch the contradictions number tick up after a fresh ingest.

---

### `/ingest`

**Purpose.** Add new sources to the topic and monitor the pipeline live.

**What you see.**
- **Ingest source** card (top): paste an article URL or attach a PDF, hit **Queue ingest**. Button spins ("Queuing…") while the server action runs.
- **Ingest log** (below): every source ever ingested, newest first. Each row shows:
  - Title + publisher + published date.
  - Dual **StatusPill** stack: top pill is local workflow state (`pending → extracting → judging → complete` or `failed_fetch / failed_upload`), bottom pill is Hydra indexing state (`queued / in_progress / success / errored / unknown`).
  - **Refresh icon** next to the Hydra pill: calls the `recheckHydra` server action, hits Hydra's `verify_processing` endpoint, updates the DB.
  - **4-step workflow timeline** showing where the pipeline is (fetch · upload · poll · claims+graph). Active step pulses, failed steps go red, completed steps turn emerald.
  - **Retry banner** when applicable. Red banner + "Retry failed step" for hard failures. Amber banner + "Force retry" when a source has been stuck in `pending` or `extracting` for >5 minutes.
- Header chips summarize the log: `N complete`, `N in flight`, `N failed`.

**How to use it.**
- Paste any article URL. Watch the timeline animate. Workflow finishes locally in ~5 seconds — Hydra indexing finishes in the background and pings us via webhook when done.
- For demo: ingest one URL live in front of judges. Show the timeline. Show the badge flip from `queued` → `success` via webhook with no page reload.
- If a source has been stuck for hours, hit **Force retry** — it re-runs the local pipeline immediately and resets Hydra to `queued` so the next webhook tick updates it.

---

### `/wiki/[entity]`

**Purpose.** The actual wiki page. Everything we know about one entity, sliced by how reliable it is.

**What you see.**
- **Title + type badge** (PERSON, ORG, MODEL, PRODUCT, EVENT).
- **Lede** — a Sparkles-marked callout block at the top with the LLM-synthesized summary plus `Synthesized · N sources` meta. Falls back to a dashed empty state when no lede has been generated yet.
- **Contested claims** (red, top of the page) — claim cards rendered side-by-side with their opposing source. Each card has:
  - Stance badge (`factual / opinion / prediction / leak / rumor`) + confidence percentage.
  - Claim text.
  - **Source excerpt** — actual quoted chunk pulled from HydraDB recall (when indexed). Real "press → see the underlying quote" UX. Falls back to "Citation chunk pending" placeholder when Hydra hasn't indexed the source yet.
  - Publisher + linked article title.
  - **Rationale banner** showing the LLM's reasoning for why the claims contradict (internal fallback rationales filtered out so users only see real explanations).
- **Established claims** — claims with ≥2 supporting sources or an `agree` relation. Two-column grid.
- **Single-source claims** — useful but isolated, waiting for corroboration. Two-column grid.
- **Related evidence** — claim-pair diffs from the relations table for this entity (not just contradicts — qualifies and agrees too).
- **Timeline** — every source mentioning this entity, ordered by publish date.

**How to use it.**
- Click any entity from the dashboard list.
- Reach a page directly: `/wiki/openai`, `/wiki/anthropic`, `/wiki/gpt-5-5-instant`.
- Aliases work: `/wiki/gpt-5` resolves to the GPT-5.5 Instant entity (model-family alias generation).
- Unknown slug → renders a friendly "Entity not found" page with links back to the dashboard and ingest.

---

### `/graph`

**Purpose.** Visualize the whole topic as a network. See which entities cluster, which sources mention what, and where the disputes are.

**What you see.**
- **Cytoscape canvas** (concentric layout, node colors keyed to entity type):
  - <span style="color:#1554a5">**Blue**</span> = MODEL, <span style="color:#7e5bef">**Purple**</span> = ORG, <span style="color:#0f9b6e">**Green**</span> = PERSON, <span style="color:#c4651a">**Orange**</span> = PRODUCT, <span style="color:#b03a8a">**Magenta**</span> = EVENT, <span style="color:#94a3b8">**Slate rectangle**</span> = SOURCE.
  - Node size scales with claim count.
  - Edges: <span style="color:#d11b1b">**Red**</span> = contradict, <span style="color:#128e5e">**Green**</span> = agree, <span style="color:#c47900">**Amber**</span> = qualify, <span style="color:#cbd5e1">**Gray dashed**</span> = source mentions entity.
- **Legend bar** below the canvas mapping colors to entity types and edge styles.
- **Edges table** at the bottom, sorted by impact: contradict → qualify → agree → mentions. Source-mention rows (the noisy ones) collapsed behind a `<details>` disclosure.
- Source / target labels truncated with full title on hover.

**How to use it.**
- Pan and zoom freely.
- Click a node to focus (cytoscape default). The colors make the dispute hotspots obvious — anywhere two big nodes are joined by a red edge is a place to dig in.
- Scan the Edges table for the most impactful relations first.

---

### `/query`

**Purpose.** Ask an open question against the corpus and get a synthesized answer with citations.

**What you see.**
- **Ask the wiki** card on the left: question textarea + **Ask** button. The button disables and spins ("Thinking…") while the server action runs.
- **Recent saved queries** on the right: last 8 questions you've asked, each linking to its saved page.

**How it works under the hood.**
1. Server action `askQuestion` loads up to 20 candidate sources from Postgres.
2. Calls Hydra `fullRecall(question)` to fetch graph context (knowledge-graph triplets surrounding the question).
3. Sends the question + numbered candidate sources to NIM with instructions to write the answer with inline `[N]` markers and a `citedSourceIds` array.
4. Validates cited ids against the candidate set (drops hallucinations) and renumbers `[N]` markers post-hoc so they always run 1..N matching the citation order.
5. If Hydra returned no triplets (free-tier backlog), falls back to building a graph from our Postgres `claim_relations` table for the cited sources so the Connections Used view always has something to show.
6. Saves the row to `saved_queries` with the full graph_context JSONB and redirects to `/wiki/q/<slug>`.

**Suggested questions** for the AI-industry demo corpus:
- "How is Anthropic competing with OpenAI in enterprise?"
- "How much money has Anthropic raised in 2026 and at what valuation?"
- "Did GPT-5.5 ship as a real release or as a limited rollout?"
- "Who is behind Recursive Superintelligence?"
- "What AI safety concerns are tied to self-improving systems?"

---

### `/wiki/q/[slug]`

**Purpose.** The persisted view of a single query — answer + citations + the knowledge-graph trace that produced it.

**What you see.**
- **Answer card** with the question as the title, badge "Saved query", and the synthesized markdown body. Inline `[N]` references are clickable `<sup>` anchors — clicking scrolls down to the matching numbered citation card.
- **Connections used** card with a source badge:
  - <span style="background:#dbeafe;color:#1554a5;padding:0 6px;border-radius:8px;font-size:11px">HydraDB graph</span> — triplets came from Hydra's `graph_context.query_paths` + `chunk_relations`. Predicates look like `RELATED_TO / FOUNDER_OF / DEVELOPED_BY`. Nodes are canonical entity names.
  - <span style="background:#fef3c7;color:#92400e;padding:0 6px;border-radius:8px;font-size:11px">Local fallback</span> — Hydra returned nothing, triplets came from our Postgres `claim_relations` table. Predicates are `mentions / agree / contradict / qualify`. Nodes are source titles + entity names.
  - **Cytoscape mini-graph** showing the triplets with type-colored nodes + edge labels.
  - **Triplet rows** below: `source → PREDICATE → target` with chunk context excerpt when available.
  - **1-step / Multi-step toggle** appears only when Hydra returns mixed hops. Single-class data hides the toggle and shows a count chip instead.
- **Citations** card with numbered circular badges (`1`, `2`, `3`…) matching the inline `[N]` anchors. Each row: source title (clickable to original article), publisher, publish date, Hydra status badge.

**How to use it.**
- Click any `[N]` in the answer body → page scrolls to the matching citation card (`#cite-N` anchor).
- Look at the source badge on **Connections used** to know whether Hydra's knowledge graph informed the answer or whether the local Postgres graph filled in.
- Bookmarkable URL: every saved query has a stable slug, share with anyone.

---

## Differentiators

**vs. ChatGPT / Perplexity** — they synthesize one answer and hide the conflict. We render both sides with rationale. Every claim is traceable to a source by chunk-level excerpt.

**vs. NotebookLM** — single-document focus, no multi-source reconciliation, no graph view, no contradiction surfacing.

**vs. Wikipedia** — single editorial voice + edit wars buried in talk pages. We surface disagreement as first-class UI.

**vs. RAG-over-vector-DB hackathon projects** — we exploit the *graph* features of HydraDB (`graph_context`, `query_paths`, `chunk_relations`), not just embedding search. The Connections-Used view is real graph data, not a synthesized diagram.

---

## Quick start

```bash
git clone <repo>
cd wikithon2026
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL, HYDRA_API_KEY, NIM_API_KEY
pnpm db:migrate              # applies 0001..0003 idempotently
pnpm dev                     # http://localhost:3000
```

### Required env

| Var | Source |
|-----|--------|
| `DATABASE_URL` | Neon (via Vercel Marketplace or direct) |
| `HYDRA_API_KEY` | HydraDB |
| `HYDRA_TENANT_ID` | HydraDB |
| `HYDRA_BASE_URL` | `https://api.hydradb.com` |
| `NIM_API_KEY` | NVIDIA NIM |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NIM_MODEL` | `meta/llama-3.1-8b-instruct` |
| `HYDRA_WEBHOOK_ENABLED` | `1` to enable `/api/webhooks/hydra` |
| `HYDRA_WEBHOOK_SECRET` | HMAC signing secret (≥16 chars; generate with `openssl rand -hex 32`) |

### Verification

```bash
pnpm lint && pnpm test && pnpm build
# 40 unit/integration tests, lint clean, build clean

pnpm test:e2e
# 3 Playwright specs pass + 1 skip (query test gates on NIM_API_KEY)
```

### Re-ingesting against fresh Hydra routing

After the sub-tenant-routing fix, re-upload every existing source so chunks land under the right sub-tenant:

```bash
pnpm hydra:reingest                       # all rows
pnpm hydra:reingest <url>                 # just one
```

### Registering the Hydra webhook

Once `HYDRA_WEBHOOK_ENABLED=1` and the app is reachable on a public URL:

```bash
curl -X POST https://api.hydradb.com/webhooks/indexing \
  -H "Authorization: Bearer $HYDRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://your-app.example.com/api/webhooks/hydra\",
    \"event_types\": [\"indexing.status_changed\"],
    \"signing_secret\": \"$HYDRA_WEBHOOK_SECRET\"
  }"
```

---

## Project layout

```
src/
  app/
    page.tsx                       # dashboard
    ingest/                        # /ingest + server actions (retry, recheck)
    graph/page.tsx
    query/                         # /query + askQuestion action
    wiki/[entity]/                 # entity page + not-found
    wiki/q/[slug]/                 # saved query page with Connections Used
    api/webhooks/hydra/route.ts    # HMAC-verified Hydra webhook
  components/
    graph/topic-graph.tsx          # cytoscape topic graph
    connections-used.tsx           # client-side Connections Used view
    status-pill.tsx                # shared workflow + hydra pill cluster
    ui/                            # shadcn primitives
  lib/
    ingest-workflow.ts             # the pipeline
    hydra.ts                       # upload + recall + verify_processing
    llm.ts                         # NIM client + all prompts + Zod schemas
    recall.ts                      # entity chunk fetch + graph extractors
    store.ts                       # Postgres + memory store split
    app-service.ts                 # store wrappers + cache invalidation
    normalize-source.ts            # Readability + Jina fallback
    types.ts                       # shared types
    demo-data.ts                   # deterministic demo seed
    utils.ts                       # cn + slugify
db/
  migrate.ts                       # iterates db/migrations/*.sql in order
  migrations/
    0001_consensuswiki.sql         # base schema
    0002_workflow_status.sql       # workflow / hydra status split
    0003_saved_query_graph_context.sql  # persist Hydra graph_context per query
scripts/
  reingest-hydra.ts                # bulk re-upload existing sources
tests/
  unit/                            # Vitest: hydra, llm, normalize-source, data
  integration/                     # store + workflow + ingest-action
  e2e/                             # Playwright smoke
docs/specs/                        # design spec
docs/superpowers/plans/            # implementation plans + audit + handoffs
```

---

## What's working now

- Full ingest pipeline (fetch → normalize → Hydra upload → poll → claim extract → canonicalize → contradiction judge → lede synthesize → revalidate)
- Stable SHA-256 ids; idempotent inserts
- Three-bucket claim grouping with side-by-side contested cards
- Cytoscape topic graph with type-colored nodes, edge ranking, table fallback
- Inline numeric citations on saved queries with anchor scroll
- Connections Used view backed by Hydra `graph_context` (with Postgres fallback when Hydra has nothing yet)
- Real-time Hydra status via signed webhooks
- Per-row Hydra recheck + workflow retry buttons
- Model-family alias generation
- E2e suite stable against live data (no demo-seed dependency)
- 40 unit/integration tests, lint+build clean

## Stretch Goals

Pulled from the [design spec](docs/specs/2026-05-16-consensuswiki-design.md) and our own backlog:

1. **Vercel Workflow (WDK)** — replace `after()` fire-and-forget with durable step execution + retry semantics + step UI.
2. **PDF uploads** — `normalizePdf` is a stub; wire `pdf-parse` against Vercel Blob.
3. **Vercel Runtime Cache for `fullRecall`** — 5-min TTL keyed by `(query_hash, sub_tenant)` to cut Hydra quota use.
4. **Backfill `claims.chunk_uuid` from recall** — direct chunk anchors per claim instead of best-match by source id.
5. **Lede regen heuristic** — regenerate only when source count grows ≥3 since `source_count_at_gen`.
6. **NIM warm-up ping** in `instrumentation.ts` to prevent cold-start jitter on stage.
7. **OpenRouter wrapper** behind an env flag for multi-LLM fallback.
8. **Publisher bias chip** on cited sources.
9. **RSS poller** for continuous topic ingest.
10. **Admin entity-merge UI** for manual canonicalization fixups.

---

## Acknowledgements

- **HydraDB** — knowledge graph + recall + webhooks. The `graph_context` features are why this app exists.
- **NVIDIA NIM** — every LLM call.
- **Vercel** — hosting target (Functions + webhooks + Next.js 16).
- **Neon** — Postgres via the Vercel Marketplace.
- **shadcn/ui**, **cytoscape**, **Tailwind v4**, **lucide-react** — UI plumbing.

---

## License

MIT (or as configured in `LICENSE`). Hackathon submission code, use freely.
