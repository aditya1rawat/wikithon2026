# ConsensusWiki Site Polish Implementation Plan

> **Execution mode:** Inline (no subagents). Work top-to-bottom. Each task ends with a commit. Steps use `- [ ]` checkbox syntax.

**Goal:** Fix the 4 Critical + 4 High + 5 Medium + 5 Low issues identified in `2026-05-17-site-audit.md`. Produce a polished, working live site.

**Architecture:** Iterative per-issue patches. Most are small UI/logic changes in existing files. No new subsystems. One shared `StatusPill` component extracted to dedupe ingest + dashboard styling.

**Tech Stack:** Next.js 16 App Router (server components), TypeScript, Vitest, Tailwind v4, shadcn/ui, Cytoscape, Lucide.

---

## File Inventory

**Source files modified:**
- `src/components/graph/topic-graph.tsx` — fix render race (Task 1)
- `src/lib/llm.ts` — fallback claim prefix, neutral judgement rationale (Tasks 2, 4)
- `src/app/wiki/[entity]/page.tsx` — source title clamp, hide internal rationale (Tasks 3, 5)
- `src/app/query/page.tsx` — remove demo button, add recent saved queries list (Task 6)
- `src/lib/app-service.ts` — `listSavedQueries()` helper (Task 6)
- `src/lib/store.ts` — `listSavedQueries` on store + dashboard heuristic (Tasks 6, 7)
- `src/app/page.tsx` — entity pagination, status pill share, hero CTA polish (Tasks 7, 8, 11)
- `src/app/ingest/page.tsx` — use shared StatusPill (Task 8)
- `src/app/graph/page.tsx` — edge table filter + title clamp (Tasks 9, 10)

**Source files created:**
- `src/components/status-pill.tsx` — shared workflow+hydra pill cluster (Task 8)
- `src/app/wiki/[entity]/not-found.tsx` — 404 page (Task 12)

**Test files:**
- `tests/unit/llm.test.ts` — fallback claim subject prefixing + rationale neutralization (Tasks 2, 4)
- `tests/integration/store.test.ts` — listSavedQueries (Task 6)

**Out of scope:**
- Lede backoff rewrite (audit #3). Requires NIM strategy decision — separate plan.
- Hydra recall chunk-matching investigation (audit #4). Diagnostic task tracked below as Task 13; no fix until we know root cause.

---

## Task 1: Fix graph canvas not rendering

**Audit ref:** Critical #1.

**Root cause hypothesis:** React 19 strict-mode double-mount + `data` prop changing reference every render causes cytoscape destroy/recreate. Plus `cose` layout may need explicit registration. Fix by stabilizing the dep and switching layout name to confirm fix.

**Files:**
- Modify: `src/components/graph/topic-graph.tsx`

- [ ] **Step 1: Add cytoscape diagnostic log**

Edit `src/components/graph/topic-graph.tsx` `useEffect` to log inside try/catch:

```ts
useEffect(() => {
  if (!ref.current) return;
  try {
    const cy = cytoscape({...});
    console.log("[topic-graph] cytoscape mounted", { nodes: cy.nodes().length, edges: cy.edges().length });
    return () => cy.destroy();
  } catch (error) {
    console.error("[topic-graph] cytoscape failed:", error);
    queueMicrotask(() => setFailed(true));
  }
}, [data]);
```

- [ ] **Step 2: Reload `/graph` in browser, check console**

If you see `cytoscape failed: ...` → it's a layout/init error, address by switching to `circle` layout. If you see `cytoscape mounted` but still no canvas in DOM → it's a double-mount race; proceed to Step 3.

- [ ] **Step 3: Stabilize the dependency + use cose-safe fallback**

Replace the entire effect with:

```ts
useEffect(() => {
  if (!ref.current) return;
  let cy: cytoscape.Core | null = null;
  try {
    cy = cytoscape({
      container: ref.current,
      elements: [
        ...data.nodes.map((node) => ({
          data: {
            id: node.id,
            label: node.label,
            type: node.type,
            color: TYPE_COLORS[node.type] ?? "#1554a5",
            size: 28 + Math.min(((node.claimCount ?? 0) * 4), 28),
          },
        })),
        ...data.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, relation: edge.relation } })),
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "background-color": "data(color)", "border-width": 2, "border-color": "#ffffff", color: "#0b1726", "font-size": 12, "font-weight": 500, width: "data(size)", height: "data(size)", "text-valign": "bottom", "text-margin-y": 8, "text-outline-width": 2, "text-outline-color": "#f6f8fb" } },
        { selector: 'node[type = "SOURCE"]', style: { shape: "round-rectangle", "background-opacity": 0.7 } },
        { selector: "edge", style: { label: "data(label)", width: 2, "line-color": "#94a3b8", "target-arrow-shape": "triangle", "target-arrow-color": "#94a3b8", "curve-style": "bezier", "font-size": 10, color: "#4b5868", opacity: 0.85 } },
        { selector: 'edge[relation = "mentions"]', style: { "line-style": "dashed", "line-color": "#cbd5e1", "target-arrow-color": "#cbd5e1", opacity: 0.6 } },
        { selector: 'edge[relation = "contradict"]', style: { "line-color": "#d11b1b", "target-arrow-color": "#d11b1b", width: 3 } },
        { selector: 'edge[relation = "agree"]', style: { "line-color": "#128e5e", "target-arrow-color": "#128e5e" } },
        { selector: 'edge[relation = "qualify"]', style: { "line-color": "#c47900", "target-arrow-color": "#c47900" } },
      ],
      layout: { name: "concentric", animate: false, padding: 30 },
    });
    cy.fit();
  } catch (error) {
    console.error("[topic-graph] cytoscape init failed:", error);
    queueMicrotask(() => setFailed(true));
  }
  return () => {
    cy?.destroy();
  };
  // Depend on counts so we don't recreate the graph on identical re-renders that differ only by object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [data.nodes.length, data.edges.length]);
```

Key changes:
- Layout `cose` → `concentric` (built-in, no plugin needed, more reliable on first paint).
- Dependency `[data]` → `[data.nodes.length, data.edges.length]` so React only re-runs the effect when the shape actually changes.
- `cy.fit()` after init ensures it sizes to the container.
- Eslint disable comment for the exhaustive-deps rule (intentional).

- [ ] **Step 4: Verify in browser**

```bash
pnpm dev   # in main repo path; user may already have running
```

Reload `/graph`. Confirm:
- Nodes visible
- Edges visible
- Console shows no `[topic-graph]` errors

- [ ] **Step 5: Lint + test + build**

```bash
cd /Users/adityarawat/Documents/github/wikithon2026 && pnpm lint && pnpm test && pnpm build
```

Expected: clean lint, 38/38 tests, build success.

- [ ] **Step 6: Commit**

```bash
git add src/components/graph/topic-graph.tsx
git commit -m "fix(graph): switch to concentric layout and stabilize effect deps"
```

---

## Task 2: Fallback extractor prefixes entity subject

**Audit ref:** Critical #2.

**Fix:** In `fallbackExtractClaims`, when a sentence starts with a verb or pronoun, prefix it with the inferred entity name so the claim text is self-contained.

**Files:**
- Modify: `src/lib/llm.ts`
- Test: `tests/unit/llm.test.ts`

- [ ] **Step 1: Write failing test**

Append to existing describe block in `tests/unit/llm.test.ts`:

```ts
test("fallback extraction prepends entity name to subjectless sentences", async () => {
  const claims = await extractClaims("released GPT-5.5, its newest AI model last month. OpenAI announced the rollout.");
  // First sentence starts with verb → should be prefixed
  expect(claims[0].claim).toMatch(/GPT-5/i);
  expect(claims[0].claim.startsWith("released")).toBe(false);
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/adityarawat/Documents/github/wikithon2026 && pnpm test -- tests/unit/llm.test.ts
```

Expected: FAIL — claim starts with "released" (no subject prefix).

- [ ] **Step 3: Update `fallbackExtractClaims`**

In `src/lib/llm.ts`, replace `fallbackExtractClaims` (around lines 171-185):

```ts
function fallbackExtractClaims(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40 && sentence.length < 260)
    .slice(0, 5);
  const claims = sentences.map((sentence) => {
    const entity = inferEntity(sentence);
    const startsWithCapitalSubject = /^[A-Z][A-Za-z0-9.-]+\s/.test(sentence);
    const claimText = startsWithCapitalSubject ? sentence : `${entity} ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
    return {
      entity,
      claim: claimText,
      stance: "factual" as const,
      confidence: 0.62,
    };
  });
  return ClaimExtractionSchema.parse({ claims }).claims;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm test -- tests/unit/llm.test.ts
```

Expected: PASS, no regressions (≥9 tests in this file).

- [ ] **Step 5: Lint + full test**

```bash
pnpm lint && pnpm test
```

Expected: 39/39 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm.ts tests/unit/llm.test.ts
git commit -m "fix(llm): prefix entity name on subjectless fallback claims"
```

---

## Task 3: Clamp long source titles on claim cards

**Audit ref:** High #7.

**Fix:** Add `line-clamp-2` to the source link/text in ClaimCard so long titles don't bleed.

**Files:**
- Modify: `src/app/wiki/[entity]/page.tsx`

- [ ] **Step 1: Apply clamp**

In `src/app/wiki/[entity]/page.tsx`, find the source link block in `ClaimCard` (around line 182-188):

```tsx
        {claim.source.url ? (
          <Link href={claim.source.url} className="block text-sm font-medium text-primary hover:underline">
            {sourceLabel}
          </Link>
        ) : (
          <div className="text-sm text-muted-foreground">{sourceLabel}</div>
        )}
```

Replace with:

```tsx
        {claim.source.url ? (
          <Link href={claim.source.url} title={sourceLabel} className="block text-sm font-medium text-primary hover:underline line-clamp-2">
            {sourceLabel}
          </Link>
        ) : (
          <div className="text-sm text-muted-foreground line-clamp-2" title={sourceLabel}>{sourceLabel}</div>
        )}
```

- [ ] **Step 2: Verify in browser**

Reload `/wiki/anthropic`. Long TechCrunch titles should now truncate to 2 lines with full title in tooltip.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/wiki/[entity]/page.tsx'
git commit -m "fix(wiki): clamp long source titles on claim cards"
```

---

## Task 4: Neutralize fallback judgement rationale

**Audit ref:** High #8.

**Fix:** Replace user-facing "Deterministic fallback used because the judgement provider was unavailable." with a neutral phrase that describes the actual claim relation.

**Files:**
- Modify: `src/lib/llm.ts`
- Test: `tests/unit/llm.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/unit/llm.test.ts`:

```ts
test("fallback judgement rationale does not leak internal status", async () => {
  const judgement = await judgeContradictions("Model X released in May", "Model X delayed until late 2026");
  expect(judgement.rationale).not.toMatch(/fallback|provider|unavailable/i);
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
pnpm test -- tests/unit/llm.test.ts
```

Expected: FAIL — rationale contains "fallback".

- [ ] **Step 3: Rewrite `fallbackJudgement`**

In `src/lib/llm.ts`, replace `fallbackJudgement` (lines 202-205):

```ts
function fallbackJudgement(a: string, b: string) {
  const contradicts = /not|late|dispute|non-public|contradict/i.test(`${a} ${b}`);
  const relation = contradicts ? "contradict" : "unrelated";
  const rationale = contradicts
    ? "Stance language in the two claims pushes opposite directions."
    : "No direct overlap between the claims' framing.";
  return JudgementSchema.parse({ relation, rationale, confidence: 0.5 });
}
```

Also update the no-key inline branch (around line 117) similarly:

```ts
  if (!process.env.NIM_API_KEY) {
    const contradicts = /not|late|dispute|non-public/i.test(`${a} ${b}`);
    const rationale = contradicts
      ? "Stance language separates release timing in the two sources."
      : "Claims align on the framing without conflict.";
    return JudgementSchema.parse({ relation: contradicts ? "contradict" : "agree", rationale, confidence: 0.75 });
  }
```

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: 40/40 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts tests/unit/llm.test.ts
git commit -m "fix(llm): neutral user-facing rationale on judgement fallback"
```

---

## Task 5: Hide internal rationale leaks at render time (belt-and-suspenders)

**Audit ref:** High #8 (UI side).

**Fix:** Defensive — even if some old DB rows have the old "Deterministic fallback used..." text, the UI should hide them.

**Files:**
- Modify: `src/app/wiki/[entity]/page.tsx`

- [ ] **Step 1: Filter rationale at display**

In `src/app/wiki/[entity]/page.tsx`, find the contested rationale render (around line 214):

```tsx
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{item.relations[0]?.rationale}</div>
```

Replace with:

```tsx
        {item.relations[0]?.rationale && !INTERNAL_RATIONALE_RE.test(item.relations[0].rationale) ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{item.relations[0].rationale}</div>
        ) : null}
```

Add near the top of the file (after imports):

```ts
const INTERNAL_RATIONALE_RE = /fallback (used|because)|provider (was )?unavailable/i;
```

Same for related-evidence section in EntityPage (~line 88):

```tsx
                  {relation.rationale ? <p className="text-sm text-muted-foreground md:col-span-3">{relation.rationale}</p> : null}
```

Replace with:

```tsx
                  {relation.rationale && !INTERNAL_RATIONALE_RE.test(relation.rationale) ? <p className="text-sm text-muted-foreground md:col-span-3">{relation.rationale}</p> : null}
```

- [ ] **Step 2: Reload `/wiki/anthropic`**

Red banner with internal text should disappear.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/wiki/[entity]/page.tsx'
git commit -m "fix(wiki): hide rationale strings that match internal-fallback patterns"
```

---

## Task 6: Replace demo button with real saved-query list on /query

**Audit ref:** High #5, Medium #13.

**Fix:** Drop the broken "Open saved GPT-5 release page" button. Add a `listSavedQueries()` helper. Right card renders the 8 most recent saved queries from the live DB.

**Files:**
- Modify: `src/lib/store.ts` (add `listSavedQueries` to interface + both impls)
- Modify: `src/lib/app-service.ts` (export wrapper)
- Modify: `src/app/query/page.tsx`
- Test: `tests/integration/store.test.ts`

- [ ] **Step 1: Add interface method + memory impl**

In `src/lib/store.ts`, find the `ConsensusStore` interface and add:

```ts
listSavedQueries(limit?: number): Promise<SavedQuery[]>;
```

In `createMemoryStore`, add inside the returned object:

```ts
async listSavedQueries(limit = 8) {
  return savedQueries.slice(0, limit).map(cloneSavedQuery);
},
```

- [ ] **Step 2: Add postgres impl**

In the postgres `store: ConsensusStore` literal, add:

```ts
async listSavedQueries(limit = 8) {
  const rows = await sql`
    SELECT id, topic_id, slug, question, answer_md, cited_source_ids, saved_at
    FROM saved_queries
    ORDER BY saved_at DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToSavedQuery);
},
```

- [ ] **Step 3: Add app-service wrapper**

In `src/lib/app-service.ts`, append:

```ts
export async function listSavedQueries(limit = 8) {
  return store.listSavedQueries(limit);
}
```

- [ ] **Step 4: Write failing test**

In `tests/integration/store.test.ts`, append:

```ts
test("listSavedQueries returns recent saved queries, most recent first", async () => {
  const store = createMemoryStore({ seedDemoData: false });
  await store.upsertTopic(demoTopic);
  await store.saveQuery("first", "answer 1", []);
  await store.saveQuery("second", "answer 2", []);
  const recent = await store.listSavedQueries(5);
  expect(recent).toHaveLength(2);
  expect(recent[0].question).toBe("second");
  expect(recent[1].question).toBe("first");
});
```

- [ ] **Step 5: Run, confirm pass**

```bash
pnpm test -- tests/integration/store.test.ts
```

Expected: PASS (memory store unshifts saved queries so newest is at index 0).

- [ ] **Step 6: Rewrite `/query` page**

Replace `src/app/query/page.tsx` content entirely:

```tsx
import Link from "next/link";
import { ListChecks, Search } from "lucide-react";
import { askQuestion } from "./actions";
import { listSavedQueries } from "@/lib/app-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function QueryPage() {
  const saved = await listSavedQueries(8);
  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Ask the wiki</CardTitle></CardHeader>
        <CardContent>
          <form action={askQuestion} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="question">Question</Label>
              <Textarea id="question" name="question" defaultValue="What is contested about GPT-5 release timing?" />
            </div>
            <Button type="submit">Synthesize and save</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5" /> Recent saved queries</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {saved.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
              No queries saved yet. Ask one to start the list.
            </p>
          ) : (
            saved.map((query) => (
              <Link
                key={query.id}
                href={`/wiki/q/${query.slug}`}
                className="block rounded-md border bg-card/70 p-3 transition-colors hover:border-primary/40 hover:bg-card"
              >
                <div className="font-medium leading-6 line-clamp-1">{query.question}</div>
                <div className="mt-1 text-xs text-muted-foreground">{new Date(query.savedAt).toLocaleString()}</div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Lint + tests + build**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected: 41/41 pass, build clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/store.ts src/lib/app-service.ts src/app/query/page.tsx tests/integration/store.test.ts
git commit -m "feat(query): replace demo button with recent saved-queries list"
```

---

## Task 7: Paginate dashboard entity list

**Audit ref:** High #6.

**Fix:** Show top 12 entities by importance heuristic (`claimCount + contestedCount * 3`), add "View all entities" link to a future entities page. For now, the link can scroll to a longer list at bottom OR be a placeholder.

Decision: scope to top-N display only. No new route. Add a "Show all" disclosure that expands inline.

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Sort + slice entities**

In `src/app/page.tsx`, modify the section that renders dashboard.entities (lines 47-55). Above the JSX, compute:

Add helper above default export:

```tsx
function rankEntities(entities: DashboardData["entities"]) {
  return [...entities].sort((a, b) => {
    const score = (e: DashboardData["entities"][number]) => e.claimCount + e.contestedCount * 3;
    return score(b) - score(a);
  });
}
```

Add import at top:

```tsx
import type { DashboardData } from "@/lib/types";
```

Inside `DashboardPage`, after `const dashboard = await getDashboard();`:

```tsx
const rankedEntities = rankEntities(dashboard.entities);
const topEntities = rankedEntities.slice(0, 12);
```

Then in JSX, replace the entities `.map((entity) =>` with:

```tsx
            {topEntities.map((entity) => (
              <Link key={entity.id} href={`/wiki/${entity.id}`} className="flex items-center justify-between gap-4 py-4 hover:text-primary">
                <div><div className="font-medium">{entity.canonicalName}</div><div className="text-sm text-muted-foreground">{entity.entityType}</div></div>
                <div className="flex gap-2"><Badge>{entity.claimCount} claims</Badge>{entity.contestedCount > 0 ? <Badge variant="destructive">{entity.contestedCount} contested</Badge> : null}</div>
              </Link>
            ))}
            {rankedEntities.length > 12 ? (
              <div className="pt-3 text-sm text-muted-foreground">
                Showing top 12 of {rankedEntities.length} tracked entities — ranked by claims and contested count.
              </div>
            ) : null}
```

Update the `<Badge>` in CardHeader from `{dashboard.entities.length} tracked` to:
```tsx
<Badge variant="secondary">{dashboard.entities.length} tracked</Badge>
```
(unchanged from existing — verify it still reads from the full list, not topEntities).

- [ ] **Step 2: Verify in browser**

Reload `/`. Should show 12 highest-impact entities. Note at bottom shows total count.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): rank and paginate entities by importance"
```

---

## Task 8: Extract shared StatusPill component

**Audit ref:** Low #18.

**Fix:** Both `/ingest` and `/` "Recent sources" show source status — but render it differently. Extract `<StatusPill source={source} />` for the dual workflow+hydra pill cluster. Use on both pages.

**Files:**
- Create: `src/components/status-pill.tsx`
- Modify: `src/app/ingest/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create shared component**

Create `src/components/status-pill.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import type { Source } from "@/lib/types";

export function StatusPill({ source, compact = false }: { source: Source; compact?: boolean }) {
  const wf = source.workflowStatus;
  const hydra = source.hydraStatus;
  const workflowFailed = wf === "failed_fetch" || wf === "failed_upload";
  const wfActive = wf === "extracting" || wf === "judging" || wf === "pending";
  return (
    <div className={`flex shrink-0 ${compact ? "flex-row items-center gap-1.5" : "flex-col items-end gap-1.5"}`}>
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          workflowFailed
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : wf === "complete"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
        }`}
      >
        {wfActive ? <Clock3 className="h-3 w-3 animate-pulse-soft" /> : workflowFailed ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        workflow · {wf}
      </span>
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          hydra === "errored"
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : hydra === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-slate-300 bg-slate-50 text-slate-600"
        }`}
      >
        hydra · {hydra}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Replace local `StatusBadge` in ingest page**

In `src/app/ingest/page.tsx`:

Add import:
```tsx
import { StatusPill } from "@/components/status-pill";
```

Find current `<StatusBadge source={source} />` call and replace with:
```tsx
<StatusPill source={source} />
```

Delete the entire local `function StatusBadge(...) { ... }` definition.

Note: the local StatusBadge had an inline Hydra recheck button. Decide: keep it where it currently is (alongside the pills) or move it inline within StatusPill via an optional `extras` prop.

Simplest: keep the existing recheck-button form OUT of StatusPill. Wrap the pill + form together in the source row instead. Replace the call site with:

```tsx
<div className="flex items-center gap-2">
  <StatusPill source={source} />
  {source.hydraStatus === "queued" || source.hydraStatus === "in_progress" || source.hydraStatus === "errored" || source.hydraStatus === "unknown" ? (
    <form action={recheckHydra}>
      <input type="hidden" name="sourceId" value={source.id} />
      <button
        type="submit"
        title="Re-check Hydra status now"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-primary"
      >
        <RefreshCw className="h-3 w-3" />
        <span className="sr-only">Re-check Hydra status</span>
      </button>
    </form>
  ) : null}
</div>
```

- [ ] **Step 3: Use StatusPill on dashboard**

In `src/app/page.tsx`, find the Recent sources card (~line 56-67):

```tsx
        <Card>
          <CardHeader><CardTitle>Recent sources</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {dashboard.sources.map((source) => (
              <div key={source.id} className="rounded-md border bg-card p-3">
                <div className="font-medium leading-6">{source.title}</div>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>{source.publisher}</span><Badge variant="secondary">{source.hydraStatus}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
```

Replace `<Badge variant="secondary">{source.hydraStatus}</Badge>` with `<StatusPill source={source} compact />`.

Add import at top of `src/app/page.tsx`:
```tsx
import { StatusPill } from "@/components/status-pill";
```

- [ ] **Step 4: Verify in browser**

Reload `/` — Recent sources card shows compact dual pills.
Reload `/ingest` — Source rows show vertical dual pills (unchanged visually).

- [ ] **Step 5: Lint + test + build**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected: 41/41 pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/status-pill.tsx src/app/ingest/page.tsx src/app/page.tsx
git commit -m "refactor: extract shared StatusPill for ingest + dashboard"
```

---

## Task 9: Edge table — sort by relation importance + hide mentions by default

**Audit ref:** Medium #11.

**Fix:** Sort edges contradict > qualify > agree > mentions. Filter `mentions` behind a checkbox (server-rendered with URL param fallback, OR just CSS `details/summary` for zero-JS).

Use `<details>` for the mentions section — zero-JS, server-rendered.

**Files:**
- Modify: `src/app/graph/page.tsx`

- [ ] **Step 1: Sort + split edges**

Replace the table body section of `src/app/graph/page.tsx` (around lines 24-44). The full updated page:

```tsx
import { getGraphData } from "@/lib/app-service";
import { TopicGraph } from "@/components/graph/topic-graph";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { GraphEdge } from "@/lib/types";

const RELATION_RANK: Record<string, number> = { contradict: 0, qualify: 1, agree: 2, mentions: 3, cites: 3 };

export default async function GraphPage() {
  const data = await getGraphData();
  const sortedEdges = [...data.edges].sort(
    (a, b) => (RELATION_RANK[a.relation] ?? 4) - (RELATION_RANK[b.relation] ?? 4),
  );
  const primaryEdges = sortedEdges.filter((edge) => edge.relation !== "mentions" && edge.relation !== "cites");
  const mentionEdges = sortedEdges.filter((edge) => edge.relation === "mentions" || edge.relation === "cites");

  const nodeLabel = (id: string) => data.nodes.find((node) => node.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Topic graph</h1>
        <p className="mt-2 text-muted-foreground">HydraDB graph context becomes entity nodes and relation edges. Red edges mark disputes.</p>
      </section>
      <TopicGraph data={data} />
      <Card>
        <CardHeader>
          <CardTitle>Edges</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm leading-6 text-muted-foreground">
            Sorted by relation impact: contradict, qualify, agree, then source mentions (collapsed).
          </p>
          <Table>
            <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Target</TableHead><TableHead>Relation</TableHead><TableHead>Rationale</TableHead></TableRow></TableHeader>
            <TableBody>
              {primaryEdges.length ? (
                primaryEdges.map((edge) => <EdgeRow key={edge.id} edge={edge} sourceLabel={nodeLabel(edge.source)} targetLabel={nodeLabel(edge.target)} />)
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">No agree/contradict/qualify edges yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {mentionEdges.length ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-primary">
                Show {mentionEdges.length} source-mention edges
              </summary>
              <Table className="mt-3">
                <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Target</TableHead><TableHead>Relation</TableHead><TableHead>Rationale</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mentionEdges.map((edge) => <EdgeRow key={edge.id} edge={edge} sourceLabel={nodeLabel(edge.source)} targetLabel={nodeLabel(edge.target)} />)}
                </TableBody>
              </Table>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function EdgeRow({ edge, sourceLabel, targetLabel }: { edge: GraphEdge; sourceLabel: string; targetLabel: string }) {
  return (
    <TableRow>
      <TableCell className="max-w-[20rem] truncate" title={sourceLabel}>{sourceLabel}</TableCell>
      <TableCell className="max-w-[20rem] truncate" title={targetLabel}>{targetLabel}</TableCell>
      <TableCell><Badge variant={edge.relation === "contradict" ? "destructive" : "secondary"}>{edge.relation}</Badge></TableCell>
      <TableCell className="text-sm text-muted-foreground">{edge.rationale ?? "No rationale stored."}</TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 2: Verify in browser**

Reload `/graph` — primary edges shown first, mentions in collapsible `<details>`.

- [ ] **Step 3: Commit**

```bash
git add src/app/graph/page.tsx
git commit -m "fix(graph): rank edges by relation, collapse mentions behind details"
```

---

## Task 10: Truncate long source titles in edge table

**Audit ref:** Medium #12.

**Status:** Already done in Task 9 — `EdgeRow` uses `max-w-[20rem] truncate` on source/target cells. Mark satisfied; no separate commit.

---

## Task 11: Beefier hero CTAs

**Audit ref:** Medium #10.

**Fix:** Bump padding, add shadow to primary CTA, weight on outline button.

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update button block**

Find the CTAs in `/` hero (around line 20-23):

```tsx
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/ingest">Ingest source <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" size="lg"><Link href="/graph">Open graph</Link></Button>
          </div>
```

Replace with:

```tsx
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="px-6 text-base shadow-md hover:shadow-lg">
              <Link href="/ingest">Ingest source <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="px-6 text-base font-semibold">
              <Link href="/graph">Open graph</Link>
            </Button>
          </div>
```

- [ ] **Step 2: Verify in browser**

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): beef up hero CTAs"
```

---

## Task 12: Add /wiki/[entity] not-found page

**Audit ref:** Low #14.

**Files:**
- Create: `src/app/wiki/[entity]/not-found.tsx`

- [ ] **Step 1: Create not-found page**

Create `src/app/wiki/[entity]/not-found.tsx`:

```tsx
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EntityNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Search className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-3xl font-semibold tracking-tight">Entity not found</h1>
      <p className="max-w-md text-muted-foreground">
        This entity isn't tracked yet. Ingest a source that mentions it, or browse existing entities from the dashboard.
      </p>
      <div className="flex gap-3">
        <Button asChild><Link href="/">Back to dashboard</Link></Button>
        <Button asChild variant="outline"><Link href="/ingest">Ingest a source</Link></Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Navigate to `/wiki/some-fake-slug`. Should show the not-found page instead of blank.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/wiki/[entity]/not-found.tsx'
git commit -m "feat(wiki): add not-found page for unknown entities"
```

---

## Task 13: Diagnose Hydra chunk match (no fix yet)

**Audit ref:** Critical #4. Investigation task — no code change unless diagnosis is conclusive.

**Steps:**

- [ ] **Step 1: Add temporary log in getChunksForEntity**

Edit `src/lib/recall.ts`, in `getChunksForEntity`, before the return:

```ts
console.log("[recall:diag]", canonicalName, {
  chunkCount: chunks.length,
  firstChunk: chunks[0] ? { source_id: chunks[0].source_id, content_preview: chunks[0].chunk_content?.slice(0, 80) } : null,
  matchedSources: Object.keys(bySource).length,
});
```

- [ ] **Step 2: Restart dev server, visit /wiki/openai**

Watch terminal log. Three possible outcomes:

| Result | Meaning |
|---|---|
| `chunkCount: 0` everywhere | Hydra returns nothing — either sub_tenant mismatch or no entities have been indexed yet. Verify sub_tenant_id in `fullRecall` call. |
| `chunkCount > 0`, `matchedSources: 0` | Hydra returns chunks but `source_id` field doesn't match the SHA-256 IDs our app generates. Need a different match strategy. |
| `chunkCount > 0`, `matchedSources > 0` | Working correctly; chunks just not present for entities we tested. Try `/wiki/anthropic`. |

- [ ] **Step 3: Based on outcome, choose follow-up**

- If `chunkCount: 0`: write a separate plan task to ingest the demo sources via a fresh tenant_id or verify Hydra sub_tenant routing.
- If schema mismatch: change `recall.ts` to match chunks by full-text search against `claim.claimText` OR by `chunk.additional_metadata.id` if Hydra returns our id there.
- If working: remove the diagnostic log and proceed.

- [ ] **Step 4: Remove diagnostic log**

After diagnosis, revert the `console.log` line.

- [ ] **Step 5: Commit only if a real fix is made**

If the outcome required a code change, commit it with `fix(recall): <root cause>`. Otherwise leave this task open and document findings in a follow-up note appended to `2026-05-17-site-audit.md`.

---

## Final Verification

- [ ] **Run full local checks**

```bash
cd /Users/adityarawat/Documents/github/wikithon2026
pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: lint clean, 41/41 unit/integration pass, build success, 3 e2e pass + 1 skip (query test gated on NIM_API_KEY).

- [ ] **Browser smoke**

Walk through every page again:
1. `/` — top 12 entities, dual-pill recent sources, beefed CTAs
2. `/ingest` — pills + recheck button shared component
3. `/graph` — cytoscape renders, edge table sorted with collapsed mentions
4. `/query` — recent saved queries list (no broken demo button)
5. `/wiki/openai` — claim text has subject, no internal rationale leak, source titles clamped, chunks if Hydra returned any
6. `/wiki/fake-slug` — not-found page renders

- [ ] **Push to main when satisfied**

```bash
git push origin main
```
