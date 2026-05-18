# ConsensusWiki Live Site Audit — 2026-05-17 (after Task 12 + chunk citations)

Inspected via Chrome DevTools MCP against `https://projector-emission-catching.ngrok-free.dev/`. Pages walked: `/`, `/ingest`, `/graph`, `/query`, `/wiki/anthropic`, `/wiki/openai`, `/wiki/google`, `/wiki/sierra`.

Severity: **Critical** = broken core feature · **High** = visible UX defect · **Medium** = polish · **Low** = nice-to-have.

---

## Critical (4)

### 1. Graph canvas empty — cytoscape didn't render
**Where:** `/graph` — `[aria-label="topic graph"]` div is 1216×560 but has 0 children. No JS errors in console. Cytoscape chunk loaded (HTTP 200).

**Likely cause:** React 19 strict-mode useEffect cleanup race with cytoscape destroy + `data` dependency creating new object reference every render. Possibly also `cose` layout init silently failing on first mount.

**Fix candidates:**
- Stabilize the `data` dependency: pass `JSON.stringify(data)` as dep or memoize in parent.
- Move cytoscape init out of strict-mode-vulnerable useEffect — use `useRef` for the instance + idempotent init.
- Try `layout: { name: "circle" }` to confirm `cose` is the culprit, then re-enable cose with explicit `cytoscape.use(cose)` if needed.

**Files:** `src/components/graph/topic-graph.tsx`

---

### 2. Claim text loses entity subject
**Where:** every `/wiki/*` page.

**Examples:**
- `/wiki/openai`: `"released GPT-5.5, its newest AI model"` (should be "OpenAI released GPT-5.5...")
- `/wiki/google`: `"plans to invest up to $40 billion in Anthropic"` (should be "Google plans to invest...")
- `/wiki/anthropic`: `"has been in the lead amongst high adoption groups like finance, tech, professional services"` — sentence fragment, no subject

**Cause:** When NIM hits 429 → fallback extractor (`src/lib/llm.ts:171-185`) splits sentences by period; sentences without explicit entity name keep their pronouns/elisions ("released X...") because the entity is inferred separately via `inferEntity()` and stored on the row but the `claimText` is the raw sentence.

**Fix candidates:**
- Fallback extractor: prefix `claim.claim` with the inferred entity name when the sentence starts with a verb.
- Better: drop fallback claim text entirely — render `{canonicalName} {claimText}` at view time.
- Best: NIM 429 backoff increase (Task 12 already shipped 1.5s) + smarter retry, plus a circuit-breaker so we don't blow the quota on the next ingest.

**Files:** `src/lib/llm.ts` (`fallbackExtractClaims`, `inferEntity`), or render fix in `src/app/wiki/[entity]/page.tsx` `ClaimCard`.

---

### 3. Lede missing on most entity pages
**Where:** every checked `/wiki/*` page shows "No lede yet. Ingest more sources to synthesize one."

**Cause:** NIM 429 cascade during `synthesizeLedesStep`. The Task 12 throttle (750ms inter-call) + circuit-breaker on first 429 means after the first rate-limit hit, all subsequent entities skip lede synthesis. Across multiple ingests, ALL entities get skipped.

**Fix candidates:**
- After a workflow finishes with rate-limited entities, queue a deferred retry (cron or background) for entities without ledes.
- Use a cheaper provider for ledes (NIM Llama-3.1-8b → maybe Llama-3.1-70b would have separate rate limit, or use Hydra's synthesis if available).
- Batch all touched entities into ONE NIM call: prompt = "summarize each entity's claims into a 1-paragraph lede. Return JSON keyed by entityId." Eliminates per-entity calls entirely.

**Files:** `src/lib/ingest-workflow.ts` (`synthesizeLedesStep`), `src/lib/llm.ts` (`synthesizeLede`)

---

### 4. Citation chunks empty on every claim
**Where:** every `/wiki/*` claim card shows "Citation chunk pending; source excerpt not yet available."

**Diagnosis (need to verify):**
- Most sources have `hydra_status='queued'` (their backend backlog) — for those, recall correctly returns no chunks
- For `hydra_status='success'` rows: unclear if dev server hot-reloaded `src/lib/recall.ts` (created in last commit `9d9d1d0`). User reload may not pick up new server-side code in dev mode.
- OR Hydra recall is returning chunks but `source_id` field doesn't match `claim.sourceId` (SHA-256 our app generates) — schema mismatch.

**Fix candidates:**
- Add server-side log inside `getChunksForEntity`: log returned chunk count + first chunk's `source_id` so we know whether match logic is the problem.
- If Hydra returns its own UUIDs instead of our SHA-256, build map by chunk content fuzzy-matching the claim text. Or by source title in the chunk metadata.
- Restart dev server explicitly to ensure `recall.ts` is loaded.

**Files:** `src/lib/recall.ts`, `src/lib/hydra.ts`

---

## High (4)

### 5. Query page `/wiki/q/gpt5-release-date` button leads to 404
**Where:** `/query` right card "Open saved GPT-5 release page" button.

**Cause:** Demo saved query was in `demoSavedQueries` array but never inserted into the live Neon DB (demo seed only loads when `DATABASE_URL` is unset).

**Fix:** Remove the demo button. Replace with "Recent saved queries" list backed by real `saved_queries` table.

**Files:** `src/app/query/page.tsx`

---

### 6. Dashboard entity list unpaginated, 44+ entries
**Where:** `/` entities card.

**Cause:** `dashboard.entities` map renders all without limit.

**Fix:** Show top 12 by `claimCount + contestedCount*3` (importance heuristic) + "View all entities →" link to a new `/entities` page. Or paginate to 20 with simple "Show more" client toggle.

**Files:** `src/app/page.tsx`, `src/lib/store.ts` (`buildDashboard`)

---

### 7. Source titles overflow on entity cards
**Where:** `/wiki/anthropic` Contested cards — TechCrunch titles wrap into adjacent column space.

**Cause:** ClaimCard `<Link>` containing full title with no `truncate` or `line-clamp-2`.

**Fix:** Add `line-clamp-2 hover:line-clamp-none` on the source label, or truncate to first 60 chars with title tooltip on hover.

**Files:** `src/app/wiki/[entity]/page.tsx` `ClaimCard`

---

### 8. Internal "Deterministic fallback used" rationale leaked to user
**Where:** `/wiki/anthropic` contested-claim banner shows red box `"Deterministic fallback used because the judgement provider was unavailable."`

**Cause:** `judgeContradictions` fallback (`src/lib/llm.ts:202-205`) writes that exact string to `relation.rationale`, which the UI renders verbatim.

**Fix:** Hide rationale when it matches the fallback string. Or rewrite fallback rationale to a neutral phrase ("Heuristic match based on stance language."), or omit rationale entirely on fallback paths.

**Files:** `src/lib/llm.ts` (`fallbackJudgement`), or render filter in `src/app/wiki/[entity]/page.tsx`

---

## Medium (5)

### 9. Dashboard layout uneven — sources card too short
**Where:** `/` — 44 entities push the entities card very tall. Recent sources card (6 entries) is short → ~70% white space below it.

**Fix:** After pagination fix (#6), put a third widget below sources: "Recent contradictions" or "Stats: contradictions over time" sparkline.

---

### 10. Hero CTA buttons feel undersized
**Where:** `/` hero. "Ingest source" / "Open graph" buttons feel routine despite size="lg".

**Fix:** Increase padding, add subtle shadow, swap "Open graph" icon to a more prominent one (or keep outline but bump font weight).

**Files:** `src/app/page.tsx`

---

### 11. Edge table fallback drowning in "mentions" noise
**Where:** `/graph` — 51 edges, vast majority labeled `mentions`. No filter/sort.

**Fix:**
- Default sort: contradict > qualify > agree > mentions.
- Hide mentions by default behind a "Show source mentions" toggle.
- Add a filter chip row.

**Files:** `src/app/graph/page.tsx`

---

### 12. Long source titles in edge table wrap awkwardly
**Where:** `/graph` edge table source column.

**Fix:** `line-clamp-1` + title attribute, or show publisher only with the title as tooltip.

**Files:** `src/app/graph/page.tsx`

---

### 13. Query page right card mostly empty
**Where:** `/query` right column has only an intro paragraph and the broken demo button.

**Fix:** Replace with "Recent saved queries" list (would also fix #5). Each item links to its slug.

**Files:** `src/app/query/page.tsx`, optionally new `src/lib/app-service.ts` `listSavedQueries()` helper

---

## Low (5)

### 14. `/wiki/sierra` returns 404 (blank page)
**Where:** Manual navigation to a slug that doesn't exist returns `notFound()` which renders blank in our app (no `not-found.tsx`).

**Fix:** Add `src/app/wiki/[entity]/not-found.tsx` with "Entity not found" message + back link.

**Files:** new `src/app/wiki/[entity]/not-found.tsx`

---

### 15. HMR websocket 503 through ngrok
**Where:** dev console. Not visible to users. Doesn't affect functionality.

**Fix:** None needed. Production build won't have HMR. Optional: ngrok config to forward WS.

---

### 16. Entity rows lack visual type distinction
**Where:** `/` entities list — only text label distinguishes MODEL vs ORG vs PERSON.

**Fix:** Small color-coded dot or icon prefix matching the graph node colors (already defined in `topic-graph.tsx:TYPE_COLORS`).

**Files:** `src/app/page.tsx`, share TYPE_COLORS constant via `src/lib/utils.ts`

---

### 17. Entity card hover state weak
**Where:** `/` entities list rows.

**Fix:** Add `hover:bg-muted/50 -mx-2 px-2 rounded-md` to the row link.

---

### 18. Recent sources status badge text style inconsistent
**Where:** `/` Recent sources card shows raw `in_progress` / `success` strings as Badge variant secondary. The `/ingest` page uses styled pill clusters.

**Fix:** Reuse a shared `<StatusPill source={source} />` component between dashboard and ingest page. Move to `src/components/status-pill.tsx`.

**Files:** new `src/components/status-pill.tsx`, modify `src/app/page.tsx` + `src/app/ingest/page.tsx`

---

## Recommended fix order

1. **#1 graph render** — visible regression, breaks the core "graph" pitch
2. **#2 claim subject + #8 fallback rationale** — quick wins, both NIM-fallback symptoms
3. **#4 citation chunks** — verify whether Hydra recall is even matching; biggest investment-vs-reward question
4. **#5 + #13 query page** — kills the 404 + dead space at once
5. **#6 entity pagination + #7 title clamp + #18 status pill share** — dashboard polish round
6. **#3 lede backoff** — depends on NIM strategy; consider batching
7. **#11 + #12 graph table** — once #1 is fixed, table is less critical but still noisy
8. Remaining low-priority items as time allows

Estimated effort: #1-#8 ≈ 2-3 hours · #9-#13 ≈ 1-2 hours · #14-#18 ≈ 1 hour.
