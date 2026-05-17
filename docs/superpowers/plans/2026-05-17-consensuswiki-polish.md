# ConsensusWiki Polish + UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten remaining backlog from review (graph cleanup, fetch hardening, retry plumbing, DRY) + fix red e2e specs + ship a real UX pass via `impeccable` and `frontend-design` skills.

**Architecture:** Tasks 6-11 are tight, isolated fixes (each one file, TDD). Task 12 is a UI/UX overhaul executed via the `impeccable` audit + `frontend-design` creative direction skills, focused on the ingest pipeline experience (live workflow timeline, real loading states, polished empty/error states) and overall visual quality. Migrations stay forward-only; no schema changes.

**Tech Stack:** Next.js 16 (App Router, Cache Components), TypeScript, Vitest, Playwright, Tailwind v4, shadcn/ui Radix primitives, Cytoscape, lucide-react.

---

## File Inventory

**Source files modified:**
- `src/lib/hydra.ts` — transient retry tolerance bump (Task 8)
- `src/lib/normalize-source.ts` — UA + timeout (Task 7)
- `src/lib/store.ts` — graph filter, slugify removal (Tasks 6, 10)
- `src/lib/ingest-workflow.ts` — slugify consolidation (Task 10)
- `src/lib/utils.ts` — host `slugify` export (Task 10)
- `src/app/ingest/page.tsx` — retry form wiring (Task 9), UX pass (Task 12)
- `src/app/ingest/actions.ts` — retry server action (Task 9)
- `tests/e2e/smoke.spec.ts` — rewritten against live data assumptions (Task 11)

**Source files created:**
- Tailwind / shadcn component additions for Task 12 (TBD by Task 12's brainstorm output)

**Test files:**
- `tests/unit/normalize-source.test.ts` — UA + timeout (Task 7)
- `tests/unit/hydra.test.ts` — transient tolerance (Task 8)
- `tests/integration/store.test.ts` — graph filter (Task 6)
- `tests/integration/ingest-action.test.ts` (new) — retry action (Task 9)

---

## Task 6: Filter source nodes with zero claims from graph

**Context:** `buildGraphData` emits a `source:<id>` node for every source, even sources stuck in `queued`/`in_progress` that have no extracted claims. Result: isolated nodes clutter Cytoscape `circle` layout. Filter to sources that have at least one claim.

**Files:**
- Modify: `src/lib/store.ts` (`buildGraphData`, around lines 583-593)
- Test: `tests/integration/store.test.ts` (new test in existing describe)

- [ ] **Step 1: Add failing test**

Append to existing describe in `tests/integration/store.test.ts`:

```ts
test("graph omits source nodes that have zero claims", async () => {
  const store = createMemoryStore({ seedDemoData: false });
  await store.upsertTopic(demoTopic);

  const usedSourceId = stableSourceId(demoTopic.id, "https://example.com/used");
  const orphanSourceId = stableSourceId(demoTopic.id, "https://example.com/orphan");
  await store.upsertSource({
    id: usedSourceId,
    topicId: demoTopic.id,
    url: "https://example.com/used",
    title: "Used",
    publisher: "Example",
    publishedAt: "2026-05-17T00:00:00.000Z",
    ingestedAt: "2026-05-17T00:00:00.000Z",
    hydraStatus: "success",
    workflowStatus: "complete",
    workflowRunId: "wf-used",
  });
  await store.upsertSource({
    id: orphanSourceId,
    topicId: demoTopic.id,
    url: "https://example.com/orphan",
    title: "Orphan",
    publisher: "Example",
    publishedAt: "2026-05-17T00:00:00.000Z",
    ingestedAt: "2026-05-17T00:00:00.000Z",
    hydraStatus: "queued",
    workflowStatus: "pending",
    workflowRunId: "wf-orphan",
  });
  const entity = await store.upsertEntityWithAliases({
    entity: {
      id: "model-x",
      topicId: demoTopic.id,
      canonicalName: "Model X",
      entityType: "MODEL",
      hydraEntityId: null,
      firstSeen: "2026-05-17T00:00:00.000Z",
    },
    aliases: ["Model X"],
  });
  await store.insertClaims([
    {
      id: stableClaimId(usedSourceId, "Model X shipped."),
      sourceId: usedSourceId,
      entityId: entity.id,
      claimText: "Model X shipped.",
      stance: "factual",
      confidence: 0.9,
      chunkUuid: null,
      extractedAt: "2026-05-17T00:00:00.000Z",
    },
  ]);

  const graph = await store.getGraphData();
  const sourceNodes = graph.nodes.filter((node) => node.id.startsWith("source:"));
  expect(sourceNodes.map((node) => node.id)).toEqual([`source:${usedSourceId}`]);
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm test -- tests/integration/store.test.ts
```

Expected: FAIL — orphan source still emitted.

- [ ] **Step 3: Filter in `buildGraphData`**

Edit `src/lib/store.ts` around line 583-593. Replace the `sourceNodes` mapping:

```ts
const sourceClaimCount = new Map<string, number>();
for (const claim of snapshot.claims) {
  sourceClaimCount.set(claim.sourceId, (sourceClaimCount.get(claim.sourceId) ?? 0) + 1);
}
const sourceNodes = snapshot.sources
  .filter((source) => (sourceClaimCount.get(source.id) ?? 0) > 0)
  .map((source) => ({
    id: `source:${source.id}`,
    label: source.title,
    type: "SOURCE" as const,
    claimCount: sourceClaimCount.get(source.id) ?? 0,
  }));
```

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm test
```

Expected: 33/33 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/integration/store.test.ts
git commit -m "fix: drop source nodes with zero claims from topic graph"
```

---

## Task 7: User-Agent + AbortController in `normalizeUrl`

**Context:** Default Node fetch UA gets 403 on many publishers (Bloomberg, NYT, etc.). Current code only falls back to Jina on 403/429/5xx. Add a realistic UA + 15s timeout so fewer fetches need the Jina fallback at all.

**Files:**
- Modify: `src/lib/normalize-source.ts` (`normalizeUrl`, lines 13-37)
- Test: `tests/unit/normalize-source.test.ts`

- [ ] **Step 1: Failing test**

Add to existing describe in `tests/unit/normalize-source.test.ts`:

```ts
test("sends realistic UA and aborts on timeout", async () => {
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const ua = (init.headers as Record<string, string>)?.["User-Agent"] ?? "";
    expect(ua).toMatch(/Mozilla\/5\.0/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => "<html><head><title>X</title></head><body><article><p>body</p></article></body></html>",
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);

  await normalizeUrl("https://example.com/x");
  expect(fetchMock).toHaveBeenCalled();
});
```

Add `import { describe, expect, test, vi } from "vitest";` at the top of the file if missing.

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm test -- tests/unit/normalize-source.test.ts
```

Expected: FAIL — UA missing, no signal on init.

- [ ] **Step 3: Add UA + timeout helper**

Edit `src/lib/normalize-source.ts`. Add constant at top under existing constants:

```ts
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ConsensusWiki/0.1";
```

Replace `normalizeUrl` body (lines 13-37) with:

```ts
export async function normalizeUrl(url: string): Promise<NormalizedSource> {
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return normalizeViaJina(url);
  }
  clearTimeout(timer);
  if (!response.ok) {
    if (response.status === 403 || response.status === 429 || response.status >= 500) return normalizeViaJina(url);
    throw new Error(`Fetch failed: ${response.status}`);
  }
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const metadata = extractMetadata(dom.window.document, url);
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent) {
    return {
      title: article.title || metadata.title,
      publisher: metadata.publisher,
      publishedAt: metadata.publishedAt,
      bodyText: truncateText(article.textContent),
    };
  }
  return normalizeViaJina(url);
}
```

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm test
```

Expected: 34/34 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize-source.ts tests/unit/normalize-source.test.ts
git commit -m "feat: send realistic UA and timeout source fetches"
```

---

## Task 8: Bump Hydra transient retry tolerance + reset on success

**Context:** `pollHydraStatus` throws on the 2nd consecutive transient failure during a 90s ceiling. Too brittle for flaky network. Lift to 3 consecutive failures and ensure success resets the counter.

**Files:**
- Modify: `src/lib/hydra.ts` (`pollHydraStatus`, lines 55-78)
- Test: `tests/unit/hydra.test.ts`

- [ ] **Step 1: Failing test**

Append to describe block in `tests/unit/hydra.test.ts`:

```ts
test("tolerates up to two transient failures before throwing", async () => {
  process.env = {
    ...originalEnv,
    HYDRA_API_KEY: "test-key",
    HYDRA_TENANT_ID: "tenant-1",
    HYDRA_BASE_URL: "https://hydra.test",
  };
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("net 1"))
    .mockRejectedValueOnce(new Error("net 2"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ file_id: "s1", indexing_status: "completed" }] }) });
  vi.stubGlobal("fetch", fetchMock);

  await expect(pollHydraStatus("s1", { intervalMs: 1, ceilingMs: 200 })).resolves.toMatchObject({ status: "completed" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("throws when transient failures exceed tolerance", async () => {
  process.env = {
    ...originalEnv,
    HYDRA_API_KEY: "test-key",
    HYDRA_TENANT_ID: "tenant-1",
    HYDRA_BASE_URL: "https://hydra.test",
  };
  const fetchMock = vi.fn().mockRejectedValue(new Error("net"));
  vi.stubGlobal("fetch", fetchMock);

  await expect(pollHydraStatus("s1", { intervalMs: 1, ceilingMs: 200 })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm test -- tests/unit/hydra.test.ts
```

Expected: FAIL — current code throws on 2nd transient.

- [ ] **Step 3: Apply fix**

Edit `src/lib/hydra.ts`. Add constant under existing constants (line 22 area):

```ts
const MAX_TRANSIENT_FAILURES = 3;
```

Inside `pollHydraStatus` body (line 71), change:

```ts
if (transientFailures > 1) throw error;
```

to:

```ts
if (transientFailures >= MAX_TRANSIENT_FAILURES) throw error;
```

Counter reset on success already happens at line 68 — keep it.

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm test
```

Expected: 36/36 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hydra.ts tests/unit/hydra.test.ts
git commit -m "fix: tolerate up to three transient Hydra poll failures"
```

---

## Task 9: Wire ingest retry button to a real server action

**Context:** `src/app/ingest/page.tsx` renders a `Retry failed step` button with no `onClick` or form action. Add a `retryIngest` server action that re-runs `runIngestWorkflow` for the source's URL, attach it to the button via a `form action={...}` hidden POST.

**Files:**
- Modify: `src/app/ingest/actions.ts` (add `retryIngest`)
- Modify: `src/app/ingest/page.tsx` (wire button to form)
- Test: `tests/integration/ingest-action.test.ts` (new)

- [ ] **Step 1: Failing test**

Create `tests/integration/ingest-action.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => callback(),
}));

const originalEnv = process.env;

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("retryIngest", () => {
  test("re-queues a known source by id and resets workflowStatus", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "", HYDRA_API_KEY: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          "<html><head><title>Retry source</title></head><body><article><p>GPT-5 shipped in May 2026.</p></article></body></html>",
      })
    );

    const { retryIngest } = await import("@/app/ingest/actions");
    const { registerDemoIngest, getSource, updateSourceWorkflowStatus } = await import("@/lib/app-service");

    const source = await registerDemoIngest("https://example.com/retry-source");
    await updateSourceWorkflowStatus(source.id, "failed_fetch");

    const form = new FormData();
    form.set("sourceId", source.id);
    await expect(retryIngest(form)).rejects.toThrow("NEXT_REDIRECT");

    const after = await getSource(source.id);
    expect(after?.workflowStatus).toBe("complete");
  });

  test("no-ops when sourceId is missing", async () => {
    const { retryIngest } = await import("@/app/ingest/actions");
    const form = new FormData();
    await expect(retryIngest(form)).rejects.toThrow("NEXT_REDIRECT");
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm test -- tests/integration/ingest-action.test.ts
```

Expected: FAIL — `retryIngest` not exported.

- [ ] **Step 3: Add server action**

Edit `src/app/ingest/actions.ts`. Append the new export:

```ts
export async function retryIngest(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  if (sourceId) {
    const source = await getSource(sourceId);
    if (source?.url) {
      await updateSourceWorkflowStatus(sourceId, "pending");
      after(async () => {
        try {
          await runIngestWorkflow(source.url!);
        } catch {
          const latest = await getSource(sourceId);
          if (!latest || latest.workflowStatus === "pending" || latest.workflowStatus === "extracting") {
            await updateSourceWorkflowStatus(sourceId, "failed_fetch");
          }
        }
      });
    }
  }
  redirect("/ingest");
}
```

- [ ] **Step 4: Wire the button**

Edit `src/app/ingest/page.tsx`. Replace the legend Retry button (line 48-50) — convert the static button into a no-op disabled chip (legend doesn't have a sourceId):

```tsx
<Button type="button" size="sm" variant="outline" disabled>
  <RotateCcw className="h-4 w-4" /> Retry failed step
</Button>
```

For each failed source's retry (line 66-68 inside the per-source block), wrap in form:

```tsx
<form action={retryIngest}>
  <input type="hidden" name="sourceId" value={source.id} />
  <Button type="submit" size="sm" variant="outline">
    <RotateCcw className="h-4 w-4" /> Retry failed step
  </Button>
</form>
```

Add import at top of `page.tsx`:

```tsx
import { ingestSource, retryIngest } from "./actions";
```

- [ ] **Step 5: Verify**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected: 38/38 pass, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/ingest/actions.ts src/app/ingest/page.tsx tests/integration/ingest-action.test.ts
git commit -m "feat: wire ingest retry button to retryIngest server action"
```

---

## Task 10: Extract shared `slugify`

**Context:** `slugify` duplicated at `src/lib/store.ts:663` and `src/lib/ingest-workflow.ts:313`. Move to `src/lib/utils.ts` and import from both call sites.

**Files:**
- Modify: `src/lib/utils.ts` (add export)
- Modify: `src/lib/store.ts` (replace local)
- Modify: `src/lib/ingest-workflow.ts` (replace local)

- [ ] **Step 1: Read current utils**

```bash
cat src/lib/utils.ts
```

The file currently exports the Tailwind `cn` helper. Keep it.

- [ ] **Step 2: Add slugify to utils.ts**

Append to `src/lib/utils.ts`:

```ts
export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
```

- [ ] **Step 3: Remove local copy in `store.ts`**

Delete `function slugify(...)` block at `src/lib/store.ts:663`. Add import at the top of `src/lib/store.ts` (with the other `@/lib` imports):

```ts
import { slugify } from "./utils";
```

- [ ] **Step 4: Remove local copy in `ingest-workflow.ts`**

Delete `function slugify(...)` block at `src/lib/ingest-workflow.ts:313`. Add import at the top:

```ts
import { slugify } from "./utils";
```

- [ ] **Step 5: Verify**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected: 38/38 pass, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils.ts src/lib/store.ts src/lib/ingest-workflow.ts
git commit -m "refactor: hoist slugify to shared utils"
```

---

## Task 11: Repair e2e smoke specs against live data assumptions

**Context:** Current `tests/e2e/smoke.spec.ts` two specs fail because they reference demo-only data that the live Neon DB doesn't have (`GPT-5` entity link, `gpt5-release-date` saved-query slug). Fix by seeding test-only state inside the spec OR by asserting against entities/saved queries that actually exist in the live dev DB. Recommend the seed-first approach: ingest a deterministic local URL and assert against the resulting page.

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Inspect current data**

```bash
node -e "const { neon } = require('@neondatabase/serverless'); require('dotenv').config({ path: '.env.local' }); const sql = neon(process.env.DATABASE_URL); sql\`SELECT id, canonical_name FROM entities LIMIT 5\`.then(r => console.log(r));"
```

Capture the canonical names that actually exist. Use one (e.g., `GPT-5.5 Instant` or `OpenAI`) for the dashboard link click.

(If `dotenv` is not installed, just open `.env.local` and run the SQL via `psql $DATABASE_URL` or any DB explorer to confirm.)

- [ ] **Step 2: Rewrite dashboard spec**

Edit `tests/e2e/smoke.spec.ts` — first test:

```ts
test("dashboard renders entities and links to entity pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /wiki that shows/i })).toBeVisible();
  const firstEntityLink = page.locator('a[href^="/wiki/"]').first();
  await expect(firstEntityLink).toBeVisible();
  await firstEntityLink.click();
  await expect(page).toHaveURL(/\/wiki\/[a-z0-9-]+/);
  await expect(page.locator('h1')).toBeVisible();
});
```

This asserts behavior (any entity link works) rather than fixed demo data.

- [ ] **Step 3: Rewrite query spec**

Replace the saved-query test:

```ts
test("query form submits and lands on a saved wiki page", async ({ page }) => {
  await page.goto("/query");
  await expect(page.getByRole("heading", { name: /Ask the wiki/i })).toBeVisible();
  await page.getByRole("textbox", { name: /Question/i }).fill("smoke test question " + Date.now());
  await page.getByRole("button", { name: /Synthesize and save/i }).click();
  await expect(page).toHaveURL(/\/wiki\/q\/[a-z0-9-]+/);
  await expect(page.getByRole("heading", { name: /smoke test question/i })).toBeVisible();
});
```

Leaves the other two tests as-is (`ingest page` and `graph page` already assert structural elements).

- [ ] **Step 4: Run**

```bash
pnpm test:e2e
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test(e2e): assert against live-data shapes, not demo seed"
```

---

## Task 12: UX overhaul (impeccable + frontend-design)

**Context:** App functions but design is generic Tailwind/shadcn. Ingestion has no live progress (cards just sit until revalidation), failed states are minimal, empty states are bland. Use the `impeccable` skill for audit + critique, `frontend-design:frontend-design` skill for creative direction and component-level rewrites, then ship.

**Scope (kept tight):**
1. Ingestion experience: live workflow timeline with optimistic UI, real loading skeleton on the ingest log, distinct visual treatment for each `WorkflowStatus` and `HydraStatus`, animated step transitions.
2. Entity / wiki page: lede emphasis, contested-claim diff styling, clearer source citation chips.
3. Graph page: replace bland Cytoscape default with a clear legend, node coloring by entity type, hover state.
4. Dashboard: bolder hero, better entity-card density, status sparkline if cheap to add.

**Out of scope:**
- New routes
- Backend schema changes
- Cytoscape replacement (keep current renderer)
- Theming system (single dark/light pass only if `impeccable` says it's cheap)

**Files (likely; finalize during step 2):**
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/ingest/page.tsx`, `src/app/graph/page.tsx`, `src/app/wiki/[entity]/page.tsx`, `src/app/wiki/q/[slug]/page.tsx`
- Modify: `src/components/graph/topic-graph.tsx`
- Modify: `src/components/ui/*.tsx` (only the components that ship)
- Possibly new: `src/components/ingest/workflow-timeline.tsx` (extract from page if it grows)
- Possibly new: `src/styles/animations.css` or extend `globals.css`

- [ ] **Step 1: Invoke the audit skill**

In the implementer subagent prompt, invoke the `impeccable` skill first (it should be in the available-skills list). Tell the skill to audit `/`, `/ingest`, `/graph`, `/wiki/gpt-5-5-instant`, `/query` against UX criteria: visual hierarchy, status legibility, loading states, error states, empty states, accessibility, motion. Capture the audit as a short markdown report.

Save to: `docs/superpowers/plans/2026-05-17-ux-audit.md`.

- [ ] **Step 2: Invoke the creative-direction skill**

Invoke `frontend-design:frontend-design`. Feed it the audit. Ask for a design plan that maps each finding to a concrete component-level change with code snippets. Capture as: `docs/superpowers/plans/2026-05-17-ux-design.md`.

- [ ] **Step 3: Implement design changes (iteratively)**

Apply the design plan one page at a time:

1. **Ingest page** — extract `WorkflowTimeline` into `src/components/ingest/workflow-timeline.tsx`; add per-step animation (CSS only, no framer-motion unless `impeccable` demands it); add Skeleton from shadcn for the log when sources are loading; rework `StatusBadge` to a compact pill cluster with icon + label.
2. **Entity page** — emphasize lede as a callout block (border-l, larger leading, accent color); rework `ContestedCard` to a true side-by-side diff with a connector line; promote source chips with publisher favicon stub (`getFavicon(url)` helper deriving from host).
3. **Graph page** — node coloring by `EntityType`; legend chip row; hover tooltip showing claim count; gentler `circle` → `cose` layout.
4. **Dashboard** — bolder typography in hero; entity list dense; recent-sources card adds time-ago.

Each substep is its own commit:

```bash
git add <files>
git commit -m "feat(ux): <page> redesign per ux-design plan"
```

- [ ] **Step 4: Verify**

```bash
pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: all green. E2e specs (already structural after Task 11) should survive the redesign. If a selector breaks, update the spec to use an `aria-label` instead of visual text where possible.

- [ ] **Step 5: Run dev server, screenshot each page**

```bash
pnpm dev
```

Visit each page; verify against the design plan.

- [ ] **Step 6: Final commit + cleanup**

If multiple `feat(ux):` commits, that's fine. If lots of fixups happened during the iteration, squash optionally with `git rebase -i` — but only locally on the branch, never on `main`.

---

## Final Verification

- [ ] **Run everything**

```bash
pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: lint clean, unit/integration ≥38 pass, build clean, e2e 4/4 pass.

- [ ] **Smoke test in browser**

```bash
pnpm dev
```

Each page renders with the redesigned UI; ingestion shows live progress; graph filters orphan nodes; retry button posts to `retryIngest`; e2e specs pass.

- [ ] **Merge**

```bash
git checkout main
git merge worktree-fix-consensuswiki-critical
git push origin main
```
