# ConsensusWiki Critical Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 correctness bugs identified during review: bad Next 16 cache cast, conflated Hydra/workflow status, postgres entity-upsert canonical-name conflict, missing code-driven model-family alias generation, missing lede synthesis after ingest.

**Architecture:** Each bug gets its own task with a failing test first, minimal fix, verification, and commit. No refactors beyond what each fix requires. Migrations are additive and idempotent. Existing 24-test suite must stay green.

**Tech Stack:** Next.js 16 (App Router, Cache Components), TypeScript, Neon Postgres (`@neondatabase/serverless`), Vitest, Zod, NVIDIA NIM, HydraDB.

---

## File Inventory

**Source files modified:**
- `src/lib/ingest-workflow.ts` — drop cast (Task 1), add lede step (Task 5), use store result from ensureEntity (Task 3), populate canonicalEntity aliases (Task 4)
- `src/lib/llm.ts` — extend `CanonicalEntitySchema` with aliases array, update prompt (Task 4), prompt for `synthesizeLede` already exists
- `src/lib/store.ts` — postgres entity upsert switch to canonical-name conflict target (Task 3), add `workflowStatus` field handling (Task 2)
- `src/lib/types.ts` — add `WorkflowStatus` type + `workflowStatus` on `Source` (Task 2)
- `src/app/ingest/page.tsx` — render both statuses (Task 2)

**Migrations created:**
- `db/migrations/0002_workflow_status.sql` (Task 2)

**Tests modified/created:**
- `tests/unit/llm.test.ts` — canonicalize-with-aliases test (Task 4)
- `tests/integration/workflow.test.ts` — lede generated after ingest, workflowStatus distinct from hydraStatus (Tasks 2, 5)
- `tests/integration/store.test.ts` — canonical-name conflict idempotent in memory store, model-family alias resolution (Tasks 3, 4)

---

## Task 1: Drop unsound `revalidateTag` cast

**Context:** Next 16 `revalidateTag(tag, profile)` is the correct signature (verified in `node_modules/next/dist/server/web/spec-extension/revalidate.d.ts`). Current code casts through `unknown` to a fabricated signature — works at runtime but hides type errors and signals confusion. Drop the cast.

**Files:**
- Modify: `src/lib/ingest-workflow.ts:235-241`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/workflow.test.ts` inside `describe("ingest workflow", ...)`:

```ts
test("calls revalidateTag with tag and profile arguments", async () => {
  process.env = { ...originalEnv, NIM_API_KEY: "", HYDRA_API_KEY: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html><head><title>t</title></head><body><article><p>GPT-5 shipped in May 2026.</p></article></body></html>",
    })
  );
  const cache = await import("next/cache");

  await runIngestWorkflow("https://example.com/tagcheck");

  const call = (cache.revalidateTag as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
    (args) => args[0] === "topic:ai-industry"
  );
  expect(call).toBeDefined();
  expect(call![1]).toBe("max");
});
```

- [ ] **Step 2: Run test to verify it passes (it should — current call is functionally correct)**

```bash
pnpm test -- tests/integration/workflow.test.ts
```

Expected: PASS. This locks behavior before refactor.

- [ ] **Step 3: Replace cast with typed call**

Edit `src/lib/ingest-workflow.ts:235-241` — replace:

```ts
function safeRevalidateTag(tag: string) {
  try {
    (revalidateTag as unknown as (tag: string, profile: string) => void)(tag, "max");
  } catch {
    // Cache invalidation is best effort in tests and local fallback mode.
  }
}
```

with:

```ts
function safeRevalidateTag(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // Cache invalidation is best effort in tests and local fallback mode.
  }
}
```

- [ ] **Step 4: Run lint + full test suite**

```bash
pnpm lint && pnpm test
```

Expected: no lint errors, 25/25 tests pass (24 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest-workflow.ts tests/integration/workflow.test.ts
git commit -m "refactor: drop unsound revalidateTag cast"
```

---

## Task 2: Split Hydra status from workflow status

**Context:** A single `hydra_status` column conflates provider indexing state with local pipeline state. After a 10s poll ceiling, source rows get stamped `in_progress` even though local extraction completes after — users see "in_progress" forever. Add a separate `workflow_status` and stop letting Hydra timeout mask local success.

**Status semantics:**

| Column | Values | Source of truth |
|--------|--------|-----------------|
| `hydra_status` | `queued`, `in_progress`, `success`, `errored`, `unknown` | HydraDB provider responses, mapped from `indexing_status` |
| `workflow_status` | `pending`, `extracting`, `judging`, `complete`, `failed_fetch`, `failed_upload` | Local ingest pipeline state |

**Files:**
- Create: `db/migrations/0002_workflow_status.sql`
- Modify: `src/lib/types.ts` (full file rewrite of `Source` interface + `HydraStatus` + new `WorkflowStatus`)
- Modify: `src/lib/store.ts` (memory + postgres paths: persist both columns)
- Modify: `src/lib/ingest-workflow.ts` (`safeUpdateSourceStatus` becomes two helpers; status mapping splits)
- Modify: `src/lib/demo-data.ts` (demo sources need `workflowStatus: "complete"`)
- Modify: `src/lib/app-service.ts` (`updateSourceStatus` already exists; add `updateSourceWorkflowStatus`)
- Modify: `src/app/ingest/page.tsx` (timeline uses workflow status; badge shows hydra status separately)
- Modify: `db/migrate.ts` to apply ordered migrations (currently only loads 0001)

- [ ] **Step 1: Write the failing test (memory store persists workflowStatus)**

Add to `tests/integration/store.test.ts` inside the existing describe:

```ts
test("persists separate hydra and workflow statuses", async () => {
  const store = createMemoryStore({ seedDemoData: false });
  await store.upsertTopic(demoTopic);

  const id = stableSourceId(demoTopic.id, "https://example.com/dual-status");
  await store.upsertSource({
    id,
    topicId: demoTopic.id,
    url: "https://example.com/dual-status",
    title: "Dual status",
    publisher: "Example",
    publishedAt: "2026-05-17T00:00:00.000Z",
    ingestedAt: "2026-05-17T00:00:00.000Z",
    hydraStatus: "in_progress",
    workflowStatus: "complete",
    workflowRunId: "wf-2",
  });

  const source = await store.getSource(id);
  expect(source?.hydraStatus).toBe("in_progress");
  expect(source?.workflowStatus).toBe("complete");

  await store.updateSourceWorkflowStatus(id, "failed_upload");
  const after = await store.getSource(id);
  expect(after?.workflowStatus).toBe("failed_upload");
  expect(after?.hydraStatus).toBe("in_progress");
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
pnpm test -- tests/integration/store.test.ts
```

Expected: FAIL — `workflowStatus` not on Source, `updateSourceWorkflowStatus` undefined.

- [ ] **Step 3: Update types**

Replace `src/lib/types.ts:4` line and add new exports — change:

```ts
export type HydraStatus = "queued" | "in_progress" | "success" | "errored" | "failed_fetch" | "failed_upload" | "hydra_errored";
```

to:

```ts
export type HydraStatus = "queued" | "in_progress" | "success" | "errored" | "unknown";
export type WorkflowStatus = "pending" | "extracting" | "judging" | "complete" | "failed_fetch" | "failed_upload";
```

Modify `Source` (lines 13-23): add `workflowStatus: WorkflowStatus` after `hydraStatus`:

```ts
export interface Source {
  id: string;
  topicId: string;
  url: string | null;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  hydraStatus: HydraStatus;
  workflowStatus: WorkflowStatus;
  workflowRunId: string | null;
}
```

- [ ] **Step 4: Create migration `db/migrations/0002_workflow_status.sql`**

```sql
-- Add workflow_status separate from hydra_status; backfill existing rows to "complete".
ALTER TABLE sources ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'pending';
UPDATE sources SET workflow_status = 'complete' WHERE workflow_status = 'pending' AND hydra_status IN ('success');
UPDATE sources SET workflow_status = 'failed_fetch' WHERE hydra_status = 'failed_fetch';
UPDATE sources SET workflow_status = 'failed_upload' WHERE hydra_status = 'failed_upload';
UPDATE sources SET hydra_status = 'errored' WHERE hydra_status IN ('hydra_errored', 'failed_fetch', 'failed_upload');
```

- [ ] **Step 5: Make `db/migrate.ts` apply all migrations in order**

Replace `db/migrate.ts:14-32` `main` body with:

```ts
async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
  const sql = neon(databaseUrl);
  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  let total = 0;
  for (const file of files) {
    const migrationPath = path.join(migrationsDir, file);
    const migration = (await readFile(migrationPath, "utf8"))
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const statements = migration
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await sql.query(statement);
    }
    total += statements.length;
    console.log(`Applied ${statements.length} statements from ${path.relative(process.cwd(), migrationPath)}.`);
  }
  console.log(`Migrations complete: ${total} statements across ${files.length} files.`);
}
```

- [ ] **Step 6: Extend memory store + postgres store**

In `src/lib/store.ts`, update `ConsensusStore` interface (around line 32) — add to the interface:

```ts
updateSourceWorkflowStatus(id: string, status: WorkflowStatus): Promise<Source | null>;
```

Add the import at top with the other type imports:

```ts
import type {
  // ...existing imports
  WorkflowStatus,
} from "./types";
```

In memory store (after `updateSourceStatus`, around line 161):

```ts
async updateSourceWorkflowStatus(id, status) {
  const source = sources.find((item) => item.id === id);
  if (!source) return null;
  source.workflowStatus = status;
  return cloneSource(source);
},
```

In memory store `upsertSource` ensure clone preserves `workflowStatus` (the existing `cloneSource` spread already does — verify it does after type change).

In postgres store `upsertSource` (replace SQL block at line 336-360):

```ts
const rows = await sql`
  INSERT INTO sources (id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id)
  VALUES (
    ${source.id},
    ${source.topicId},
    ${source.url},
    ${source.title},
    ${source.publisher},
    ${source.publishedAt},
    ${source.ingestedAt},
    ${source.hydraStatus},
    ${source.workflowStatus},
    ${source.workflowRunId}
  )
  ON CONFLICT (id) DO UPDATE SET
    topic_id = EXCLUDED.topic_id,
    url = EXCLUDED.url,
    title = EXCLUDED.title,
    publisher = EXCLUDED.publisher,
    published_at = EXCLUDED.published_at,
    ingested_at = EXCLUDED.ingested_at,
    hydra_status = EXCLUDED.hydra_status,
    workflow_status = EXCLUDED.workflow_status,
    workflow_run_id = EXCLUDED.workflow_run_id
  RETURNING id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id
`;
```

Update `loadSnapshot` source select (line 220):

```ts
sql`SELECT id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id FROM sources WHERE topic_id = ${topicId}`,
```

Same column list on `getSource` (line 285).

Add postgres `updateSourceWorkflowStatus`:

```ts
async updateSourceWorkflowStatus(id, status) {
  const rows = await sql`
    UPDATE sources
    SET workflow_status = ${status}
    WHERE id = ${id}
    RETURNING id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id
  `;
  return rows[0] ? rowToSource(rows[0]) : null;
},
```

Update `rowToSource` (line 656) — add field:

```ts
function rowToSource(row: Record<string, unknown>): Source {
  return {
    id: String(row.id),
    topicId: String(row.topic_id),
    url: nullableString(row.url),
    title: String(row.title ?? ""),
    publisher: nullableString(row.publisher),
    publishedAt: row.published_at ? toIsoString(row.published_at) : null,
    ingestedAt: toIsoString(row.ingested_at),
    hydraStatus: String(row.hydra_status ?? "queued") as HydraStatus,
    workflowStatus: String(row.workflow_status ?? "pending") as WorkflowStatus,
    workflowRunId: nullableString(row.workflow_run_id),
  };
}
```

- [ ] **Step 7: Update `demo-data.ts`**

In `src/lib/demo-data.ts:32-42`, modify `demoSources` map to set `workflowStatus: "complete"`:

```ts
export const demoSources: Source[] = sourceSpecs.map(([url, title, publisher, publishedAt]) => ({
  id: stableSourceId(demoTopic.id, url),
  topicId: demoTopic.id,
  url,
  title,
  publisher,
  publishedAt,
  ingestedAt: publishedAt,
  hydraStatus: "success",
  workflowStatus: "complete",
  workflowRunId: `demo-${sha256(url).slice(0, 8)}`,
}));
```

- [ ] **Step 8: Add app-service helper**

Add to `src/lib/app-service.ts` after `updateSourceStatus` (line 50):

```ts
export async function updateSourceWorkflowStatus(id: string, status: WorkflowStatus) {
  const saved = await store.updateSourceWorkflowStatus(id, status);
  revalidateTopicViews();
  return saved;
}
```

Add `WorkflowStatus` to the type import at line 4.

- [ ] **Step 9: Rewrite workflow status handling**

In `src/lib/ingest-workflow.ts`:

Replace the `import` line 8 with:

```ts
import type { Claim, ClaimRelation, Entity, HydraStatus, Source, Topic, WorkflowStatus } from "./types";
```

Replace `safeUpdateSourceStatus` (lines 227-233) with two helpers:

```ts
async function safeUpdateHydraStatus(sourceId: string, status: HydraStatus) {
  try {
    await store.updateSourceStatus(sourceId, status);
  } catch {
    // Best effort.
  }
}

async function safeUpdateWorkflowStatus(sourceId: string, status: WorkflowStatus) {
  try {
    await store.updateSourceWorkflowStatus(sourceId, status);
  } catch {
    // Best effort.
  }
}
```

Update `runIngestWorkflow` (lines 33-61) to thread workflow status:

```ts
export async function runIngestWorkflow(input: WorkflowInput) {
  const context = await fetchAndNormalize(input);
  try {
    await hydraUpload(context);
  } catch (error) {
    await safeUpdateWorkflowStatus(context.source.id, "failed_upload");
    throw error;
  }
  try {
    await pollHydraStatus(context);
  } catch {
    // Hydra failure does not block local pipeline.
    await safeUpdateHydraStatus(context.source.id, "errored");
  }
  await safeUpdateWorkflowStatus(context.source.id, "extracting");
  await extractClaimsStep(context);
  await safeUpdateWorkflowStatus(context.source.id, "judging");
  await judgeContradictionsStep(context);
  await safeUpdateWorkflowStatus(context.source.id, "complete");
  await invalidateCacheStep(context);

  return {
    source: context.source,
    normalized: context.normalized,
    hydraUpload: context.hydraUpload,
    hydraStatus: context.hydraStatus,
    claims: context.claims ?? [],
    persistedClaims: context.persistedClaims ?? [],
    relationCount: context.relations?.length ?? 0,
    touchedEntityIds: context.touchedEntityIds ?? [],
  };
}
```

In `fetchAndNormalize`, replace the `source` construction (line 80-87) with:

```ts
const source: Source = {
  ...registered,
  topicId: topic.id,
  title: normalized.title || registered.title,
  publisher: normalized.publisher ?? registered.publisher,
  publishedAt: normalized.publishedAt ?? registered.publishedAt,
  hydraStatus: "queued",
  workflowStatus: "pending",
};
```

In `hydraUpload` (line 103), drop the `safeUpdateSourceStatus(... "queued")` (no-op — already queued from fetchAndNormalize).

In `pollHydraStatus` (line 107-112), replace body with:

```ts
export async function pollHydraStatus(context: WorkflowContext) {
  const hydraStatus = await pollHydraProviderStatus(context.source.id, { ceilingMs: 10_000 });
  context.hydraStatus = hydraStatus;
  await safeUpdateHydraStatus(context.source.id, mapProviderStatusToHydraStatus(hydraStatus.status));
  return hydraStatus;
}
```

Rewrite `mapProviderStatusToHydraStatus` (lines 251-270):

```ts
function mapProviderStatusToHydraStatus(status: string): HydraStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "in_progress":
    case "processing":
    case "graph_creation":
      return "in_progress";
    case "success":
    case "complete":
    case "completed":
      return "success";
    case "errored":
    case "error":
    case "failed":
      return "errored";
    default:
      return "unknown";
  }
}
```

Update `actions.ts:8-22` so it catches and writes `failed_fetch` against workflowStatus (replace whole body):

```ts
export async function ingestSource(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (url) {
    const source = await registerDemoIngest(url);
    after(async () => {
      try {
        await runIngestWorkflow(url);
      } catch {
        const latest = await getSource(source.id);
        if (!latest || latest.workflowStatus === "pending" || latest.workflowStatus === "extracting") {
          await updateSourceWorkflowStatus(source.id, "failed_fetch");
        }
      }
    });
  }
  redirect("/ingest");
}
```

Add the import in `src/app/ingest/actions.ts`:

```ts
import { getSource, registerDemoIngest, updateSourceWorkflowStatus } from "@/lib/app-service";
```

Update `registerDemoIngest` in `app-service.ts:84-101`:

```ts
export async function registerDemoIngest(url: string, title?: string) {
  const id = stableSourceId(demoTopic.id, url);
  const existing = await getSource(id);
  if (existing) return existing;

  const parsed = new URL(url);
  return upsertSource({
    id,
    topicId: demoTopic.id,
    url,
    title: title || `Live source: ${parsed.hostname}`,
    publisher: parsed.hostname.replace(/^www\./, ""),
    publishedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    hydraStatus: "queued",
    workflowStatus: "pending",
    workflowRunId: `local-${Date.now()}`,
  });
}
```

- [ ] **Step 10: Update ingest page rendering**

In `src/app/ingest/page.tsx`, change the `StatusBadge` and timeline logic to read workflow status:

Replace `StatusBadge` (line 152-155):

```tsx
function StatusBadge({ source }: { source: Source }) {
  const workflowFailed = source.workflowStatus === "failed_fetch" || source.workflowStatus === "failed_upload";
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant={workflowFailed ? "destructive" : source.workflowStatus === "complete" ? "secondary" : "outline"}>
        workflow: {source.workflowStatus}
      </Badge>
      <Badge variant={source.hydraStatus === "errored" ? "destructive" : "outline"}>
        hydra: {source.hydraStatus}
      </Badge>
    </div>
  );
}
```

Replace `isFailed` (line 157-159):

```ts
function isFailed(status: Source["workflowStatus"]) {
  return status === "failed_fetch" || status === "failed_upload";
}
```

Update call sites: line 60 changes `<StatusBadge status={source.hydraStatus} />` → `<StatusBadge source={source} />`; line 63 changes `isFailed(source.hydraStatus)` → `isFailed(source.workflowStatus)`; line 65 message uses `source.workflowStatus`. Also pass workflowStatus into `buildSteps`:

Replace `WorkflowTimeline` (lines 79-97) + `buildSteps` (lines 99-114) with:

```tsx
function WorkflowTimeline({ source }: { source: Source }) {
  const steps = buildSteps(source);
  return (
    <ol className="mt-4 grid gap-2 sm:grid-cols-4">
      {steps.map((step) => {
        const StepIcon = step.icon;
        return (
          <li key={step.label} className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2">
              <StepIcon className={step.tone} />
              <span className="text-sm font-medium">{step.label}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

function buildSteps(source: Source) {
  const wf = source.workflowStatus;
  const hydra = source.hydraStatus;
  const fetchState: StepState = wf === "failed_fetch" ? "error" : "done";
  const uploadState: StepState = wf === "failed_upload" ? "error" : wf === "pending" ? "pending" : "done";
  const hydraState: StepState = hydra === "errored" ? "error" : hydra === "success" ? "done" : "pending";
  const extractState: StepState =
    wf === "complete" ? "done" : wf === "extracting" || wf === "judging" ? "pending" : wf === "failed_fetch" || wf === "failed_upload" ? "error" : "pending";

  return [
    step("Fetch and normalize", fetchState === "error" ? "Fetch failed" : "Article/PDF text ready", fetchState),
    step("Hydra upload", uploadState === "error" ? "Upload needs retry" : uploadState === "pending" ? "Waiting on upload" : "Knowledge accepted", uploadState),
    step("Hydra poll", hydraState === "error" ? "Hydra returned errored" : hydraState === "done" ? "Hydra processing complete" : `Hydra ${hydra}`, hydraState),
    step("Claims and graph", extractState === "done" ? "Claims persisted, entity pages invalidated" : extractState === "error" ? "Pipeline halted" : `Workflow ${wf}`, extractState),
  ];
}
```

- [ ] **Step 11: Lock the failure-decoupling behavior in workflow test**

Add to `tests/integration/workflow.test.ts`:

```ts
test("hydra timeout does not block local workflow_status = complete", async () => {
  process.env = {
    ...originalEnv,
    HYDRA_API_KEY: "test-key",
    HYDRA_TENANT_ID: "tenant-1",
    HYDRA_BASE_URL: "https://hydra.test",
    NIM_API_KEY: "",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `<html><head><title>x</title></head><body><article><p>OpenAI released GPT-5 as a generally available model in May 2026.</p></article></body></html>`,
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s3", status: "queued" }) })
      .mockResolvedValue({ ok: true, json: async () => ({ statuses: [{ file_id: "s3", indexing_status: "queued" }] }) })
  );

  const result = await runIngestWorkflow("https://example.com/hydra-stuck");
  const source = await getSource(result.source.id);

  expect(source?.hydraStatus).toBe("queued");
  expect(source?.workflowStatus).toBe("complete");
});
```

- [ ] **Step 12: Run lint + tests**

```bash
pnpm lint && pnpm test
```

Expected: all green (27+ tests).

- [ ] **Step 13: Build check**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 14: Run live migration (only if you want to apply to dev DB now)**

```bash
pnpm db:migrate
```

Expected: applies 0001 (idempotent) + 0002.

- [ ] **Step 15: Commit**

```bash
git add db/migrations/0002_workflow_status.sql db/migrate.ts src/lib/types.ts src/lib/store.ts src/lib/demo-data.ts src/lib/app-service.ts src/lib/ingest-workflow.ts src/app/ingest/page.tsx src/app/ingest/actions.ts tests/integration/store.test.ts tests/integration/workflow.test.ts
git commit -m "feat: split workflow_status from hydra_status

Local pipeline state and HydraDB provider state are now tracked
independently. A stuck Hydra index no longer masks completed
local extraction. Adds db/migrations/0002_workflow_status.sql,
migrate.ts iterates all migrations in order."
```

---

## Task 3: Fix postgres entity upsert on canonical-name collision + return store row

**Context:** `entities` has `UNIQUE (topic_id, canonical_name)` but `upsertEntityWithAliases` uses `ON CONFLICT (id)`. When `ensureEntity` mints a new slug-id for an already-canonical name not in `entity_aliases`, the insert fails the unique constraint and no `DO UPDATE` branch catches it. Also: `ensureEntity` returns the pre-constructed entity instead of the upserted row, so claims can attach to a wrong id when canonical resolves to an existing row.

**Files:**
- Modify: `src/lib/store.ts` (postgres `upsertEntityWithAliases` lines 371-400; memory variant lines 162-185 already uses canonical match — keep but verify)
- Modify: `src/lib/ingest-workflow.ts` (`ensureEntity` lines 202-217)

- [ ] **Step 1: Write failing test for canonical-collision resolution (memory store)**

Add to `tests/integration/store.test.ts`:

```ts
test("upsertEntityWithAliases collapses different ids with same canonical name", async () => {
  const store = createMemoryStore({ seedDemoData: false });
  await store.upsertTopic(demoTopic);

  const first = await store.upsertEntityWithAliases({
    entity: {
      id: "gpt-5",
      topicId: demoTopic.id,
      canonicalName: "GPT-5",
      entityType: "MODEL",
      hydraEntityId: null,
      firstSeen: "2026-05-17T00:00:00.000Z",
    },
    aliases: ["GPT-5"],
  });

  const second = await store.upsertEntityWithAliases({
    entity: {
      id: "gpt5",
      topicId: demoTopic.id,
      canonicalName: "GPT-5",
      entityType: "MODEL",
      hydraEntityId: "hydra-gpt-5",
      firstSeen: "2026-05-17T01:00:00.000Z",
    },
    aliases: ["gpt5"],
  });

  expect(second.id).toBe(first.id);
  expect(second.hydraEntityId).toBe("hydra-gpt-5");

  const page = await store.getEntityPage("gpt5");
  expect(page?.entity.id).toBe(first.id);
});
```

- [ ] **Step 2: Run test, check current memory store passes; postgres path is verified manually**

```bash
pnpm test -- tests/integration/store.test.ts
```

If memory store passes (it should — `findEntityByAlias` + canonical match already collapse), proceed. If it fails, fix the memory store path before postgres.

- [ ] **Step 3: Fix postgres `upsertEntityWithAliases`**

In `src/lib/store.ts` replace lines 371-400 (the postgres `upsertEntityWithAliases`):

```ts
async upsertEntityWithAliases(input) {
  await ensureDemoTopic(input.entity.topicId);
  const existingRows = await sql`
    SELECT id, topic_id, canonical_name, entity_type, hydra_entity_id, first_seen
    FROM entities
    WHERE topic_id = ${input.entity.topicId}
      AND canonical_name = ${input.entity.canonicalName}
    LIMIT 1
  `;
  const targetId = existingRows[0] ? String(existingRows[0].id) : input.entity.id;
  const rows = await sql`
    INSERT INTO entities (id, topic_id, canonical_name, entity_type, hydra_entity_id, first_seen)
    VALUES (
      ${targetId},
      ${input.entity.topicId},
      ${input.entity.canonicalName},
      ${input.entity.entityType},
      ${input.entity.hydraEntityId},
      ${input.entity.firstSeen}
    )
    ON CONFLICT (id) DO UPDATE SET
      canonical_name = EXCLUDED.canonical_name,
      entity_type = EXCLUDED.entity_type,
      hydra_entity_id = COALESCE(EXCLUDED.hydra_entity_id, entities.hydra_entity_id)
    RETURNING id, topic_id, canonical_name, entity_type, hydra_entity_id, first_seen
  `;
  const entity = rowToEntity(rows[0]);
  for (const alias of input.aliases ?? []) {
    const normalized = normalizeAlias(alias);
    if (!normalized) continue;
    await sql`
      INSERT INTO entity_aliases (alias, entity_id)
      VALUES (${normalized}, ${entity.id})
      ON CONFLICT (alias, entity_id) DO NOTHING
    `;
  }
  return entity;
},
```

- [ ] **Step 4: Update `ensureEntity` in workflow to use store result**

In `src/lib/ingest-workflow.ts:202-217`, replace whole function:

```ts
async function ensureEntity(input: { raw: string; canonicalName: string; entityType: Entity["entityType"]; topic: Topic }) {
  const existing = (await store.findEntityByAlias(input.canonicalName, input.topic.id)) ?? (await store.findEntityByAlias(input.raw, input.topic.id));
  const seed: Entity =
    existing ??
    ({
      id: slugify(input.canonicalName),
      topicId: input.topic.id,
      canonicalName: input.canonicalName,
      entityType: input.entityType,
      hydraEntityId: null,
      firstSeen: new Date().toISOString(),
    } satisfies Entity);

  return store.upsertEntityWithAliases({
    entity: { ...seed, topicId: input.topic.id },
    aliases: [input.raw, input.canonicalName],
  });
}
```

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts src/lib/ingest-workflow.ts tests/integration/store.test.ts
git commit -m "fix: collapse entity inserts on canonical-name collision

Postgres upsertEntityWithAliases now resolves an existing row by
(topic_id, canonical_name) before insert, then DO UPDATE on id.
ensureEntity returns the store result so downstream claims attach
to the canonical id."
```

---

## Task 4: Code-driven model-family alias generation

**Context:** `/wiki/gpt-5` currently routes only because of a manual DB alias row. Real fix: ingest must emit family aliases. `canonicalizeEntities` returns `{ raw, canonicalName, entityType }` today. Extend with `aliases: string[]` so the LLM can surface common variants (`gpt-5`, `gpt5`, `gpt 5`, `gpt 5.5`, `gpt-5.5-instant`). Add deterministic GPT-family fallback so the alias is correct even when the LLM omits it.

**Files:**
- Modify: `src/lib/llm.ts` (`CanonicalEntitySchema`, fallback canonicalizer, prompt)
- Modify: `src/lib/ingest-workflow.ts` (`ensureEntity` accepts aliases; `extractClaimsStep` threads them through)

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/llm.test.ts`:

```ts
test("fallback canonical entity emits family aliases for MODEL", async () => {
  const entities = await canonicalizeEntities(["GPT-5.5 Instant"]);
  expect(entities[0].canonicalName).toBe("GPT-5.5 Instant");
  expect(entities[0].entityType).toBe("MODEL");
  expect(entities[0].aliases).toContain("gpt-5");
  expect(entities[0].aliases).toContain("gpt-5.5-instant");
});

test("canonicalizeEntities returns aliases from live NIM batch", async () => {
  process.env = { ...originalEnv, NIM_API_KEY: "test-key", NIM_BASE_URL: "https://nim.test" };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              entities: [
                { raw: "gpt-5.5", canonicalName: "GPT-5.5 Instant", entityType: "MODEL", aliases: ["GPT-5", "GPT 5.5 Instant"] },
              ],
            }),
          },
        },
      ],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const entities = await canonicalizeEntities(["gpt-5.5"]);
  expect(entities[0].aliases).toEqual(expect.arrayContaining(["GPT-5", "GPT 5.5 Instant"]));
});
```

Add to `tests/integration/store.test.ts`:

```ts
test("model-family alias resolves to canonical entity page", async () => {
  const store = createMemoryStore({ seedDemoData: false });
  await store.upsertTopic(demoTopic);
  await store.upsertEntityWithAliases({
    entity: {
      id: "gpt-5-5-instant",
      topicId: demoTopic.id,
      canonicalName: "GPT-5.5 Instant",
      entityType: "MODEL",
      hydraEntityId: null,
      firstSeen: "2026-05-17T00:00:00.000Z",
    },
    aliases: ["GPT-5.5 Instant", "gpt-5", "gpt5"],
  });

  const resolved = await store.findEntityByAlias("gpt-5");
  expect(resolved?.id).toBe("gpt-5-5-instant");
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test
```

Expected: failures around `aliases` field missing on canonical schema and missing family aliases.

- [ ] **Step 3: Extend schema + prompt + fallback in `src/lib/llm.ts`**

Replace `CanonicalEntitySchema` (line 15) with:

```ts
export const CanonicalEntitySchema = z.object({
  raw: z.string(),
  canonicalName: z.string(),
  entityType: z.enum(["PERSON", "ORG", "PRODUCT", "EVENT", "MODEL"]),
  aliases: z.array(z.string()).default([]),
});
```

Replace `canonicalizeEntities` (lines 92-112):

```ts
export async function canonicalizeEntities(rawEntities: string[]) {
  const unique = [...new Set(rawEntities.map((raw) => raw.trim()).filter(Boolean))];
  if (!process.env.NIM_API_KEY) return unique.map(fallbackCanonicalEntity);
  const prompt = `Canonicalize these entity mentions as one batch.

Return JSON matching exactly:
{"entities":[{"raw":"original string","canonicalName":"canonical display name","entityType":"PERSON|ORG|PRODUCT|EVENT|MODEL","aliases":["common variants"]}]}

Rules:
- Preserve one output object for each input mention.
- aliases should include both spelling variants and parent-family names. For MODEL entities, include the family prefix (e.g., for "GPT-5.5 Instant" include "GPT-5").
- Always include the canonical name itself in aliases.

Entities:
${JSON.stringify(unique)}`;
  const retryPrompt = `${prompt}

The previous response was invalid. JSON only. Return only the object with an entities array.`;
  try {
    const result = await completeJson(prompt, CanonicalEntityBatchSchema, retryPrompt);
    return result.entities.map((entity) => ({ ...entity, aliases: dedupeAliases([entity.canonicalName, ...entity.aliases]) }));
  } catch {
    return unique.map(fallbackCanonicalEntity);
  }
}
```

Replace `fallbackCanonicalEntity` (lines 194-200):

```ts
function fallbackCanonicalEntity(raw: string) {
  const canonicalName = raw.replace(/gpt\s?5/i, "GPT-5").replace(/open ai/i, "OpenAI");
  const entityType: "MODEL" | "PERSON" | "ORG" = /gpt|claude/i.test(raw) ? "MODEL" : /sam/i.test(raw) ? "PERSON" : "ORG";
  const aliases = dedupeAliases([raw, canonicalName, ...modelFamilyAliases(canonicalName, entityType)]);
  return CanonicalEntitySchema.parse({ raw, canonicalName, entityType, aliases });
}

function modelFamilyAliases(canonicalName: string, entityType: string) {
  if (entityType !== "MODEL") return [];
  const family = canonicalName.match(/^(gpt-\d+)/i)?.[1];
  if (!family) return [];
  return [family.toLowerCase(), family.replace("-", " ").toLowerCase()];
}

function dedupeAliases(aliases: string[]) {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}
```

- [ ] **Step 4: Thread aliases through workflow**

In `src/lib/ingest-workflow.ts` `extractClaimsStep` (around line 122-144), pass aliases from canonical match to `ensureEntity`:

Replace lines 122-144:

```ts
for (const claim of claims) {
  const rawEntity = claim.entity.trim();
  if (!rawEntity) continue;
  const canonical = canonicalByRaw.get(rawEntity) ?? canonicalEntities.find((entity) => entity.canonicalName === rawEntity);
  const aliases = [
    rawEntity,
    canonical?.canonicalName ?? rawEntity,
    ...(canonical?.aliases ?? []),
  ];
  const entity = await ensureEntity({
    raw: rawEntity,
    canonicalName: canonical?.canonicalName ?? rawEntity,
    entityType: canonical?.entityType ?? "PRODUCT",
    aliases,
    topic: context.topic,
  });
  touchedEntityIds.add(entity.id);
  workflowClaims.push({ ...claim, entityId: entity.id });
  persistedClaims.push({
    id: stableClaimId(context.source.id, claim.claim),
    sourceId: context.source.id,
    entityId: entity.id,
    claimText: claim.claim,
    stance: claim.stance,
    confidence: claim.confidence,
    chunkUuid: null,
    extractedAt: new Date().toISOString(),
  });
}
```

Update `ensureEntity` signature (the function rewritten in Task 3):

```ts
async function ensureEntity(input: { raw: string; canonicalName: string; entityType: Entity["entityType"]; aliases: string[]; topic: Topic }) {
  const existing = (await store.findEntityByAlias(input.canonicalName, input.topic.id)) ?? (await store.findEntityByAlias(input.raw, input.topic.id));
  const seed: Entity =
    existing ??
    ({
      id: slugify(input.canonicalName),
      topicId: input.topic.id,
      canonicalName: input.canonicalName,
      entityType: input.entityType,
      hydraEntityId: null,
      firstSeen: new Date().toISOString(),
    } satisfies Entity);

  return store.upsertEntityWithAliases({
    entity: { ...seed, topicId: input.topic.id },
    aliases: input.aliases,
  });
}
```

- [ ] **Step 5: Run tests + lint**

```bash
pnpm lint && pnpm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm.ts src/lib/ingest-workflow.ts tests/unit/llm.test.ts tests/integration/store.test.ts
git commit -m "feat: generate model-family aliases at ingest time

canonicalizeEntities now returns an aliases[] array. The fallback
seeds GPT-N parent aliases deterministically; the LLM prompt asks
for variants and parent-family names. Ingest threads them into
upsertEntityWithAliases so /wiki/gpt-5 resolves without manual
DB rows."
```

---

## Task 5: Lede synthesis after ingest

**Context:** `synthesizeLede` exists in `llm.ts:136` and `store.upsertLede` exists, but no workflow step calls them. Entity pages show "No lede yet" forever. Add a step after `judgeContradictionsStep` that, for every touched entity, loads its claims and writes a fresh lede.

**Files:**
- Modify: `src/lib/ingest-workflow.ts` (new `synthesizeLedesStep`, called between `judgeContradictionsStep` and `invalidateCacheStep`)

- [ ] **Step 1: Write failing test**

Add to `tests/integration/workflow.test.ts`:

```ts
test("workflow writes a lede for every touched entity", async () => {
  process.env = { ...originalEnv, NIM_API_KEY: "", HYDRA_API_KEY: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<html><head><title>t</title></head><body><article><p>OpenAI released GPT-5 as a generally available model in May 2026.</p></article></body></html>`,
    })
  );

  const result = await runIngestWorkflow("https://example.com/lede-check");
  const { getEntityPage } = await import("@/lib/app-service");

  for (const entityId of result.touchedEntityIds) {
    const page = await getEntityPage(entityId);
    expect(page?.lede?.lede).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test -- tests/integration/workflow.test.ts
```

Expected: FAIL — `page.lede` is null.

- [ ] **Step 3: Add `synthesizeLedesStep` to `src/lib/ingest-workflow.ts`**

At top, add to the imports from `./llm` (line 5):

```ts
import { canonicalizeEntities, extractClaims, judgeContradictions, synthesizeLede } from "./llm";
```

Add a new step before `invalidateCacheStep` (insert after `judgeContradictionsStep` ends, around line 183):

```ts
export async function synthesizeLedesStep(context: WorkflowContext) {
  const touched = context.touchedEntityIds ?? [];
  for (const entityId of touched) {
    const page = await store.getEntityPage(entityId, context.topic.id);
    if (!page) continue;
    const claimTexts = page.claims.map((claim) => claim.claimText);
    if (claimTexts.length === 0) continue;
    try {
      const lede = await synthesizeLede(page.entity.canonicalName, claimTexts);
      await store.upsertLede({
        entityId,
        lede,
        sourceCountAtGen: page.sources.length,
        generatedAt: new Date().toISOString(),
      });
    } catch {
      // Lede generation is best-effort; entity page already renders without one.
    }
  }
}
```

Insert call in `runIngestWorkflow` after `judgeContradictionsStep` and before `invalidateCacheStep`:

```ts
await safeUpdateWorkflowStatus(context.source.id, "judging");
await judgeContradictionsStep(context);
await synthesizeLedesStep(context);
await safeUpdateWorkflowStatus(context.source.id, "complete");
await invalidateCacheStep(context);
```

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: all green.

- [ ] **Step 5: Run lint + build**

```bash
pnpm lint && pnpm build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest-workflow.ts tests/integration/workflow.test.ts
git commit -m "feat: synthesize lede for every touched entity after ingest

After judgement, iterate touched entity ids, load each entity page,
call synthesizeLede with the canonical name + claim texts, and
upsert the result. Errors are swallowed so the entity page still
renders with no lede."
```

---

## Final Verification

- [ ] **Run full local checks**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected: lint clean, all tests green (~30 total), build succeeds.

- [ ] **Apply migrations against dev DB**

```bash
pnpm db:migrate
```

Expected: `0001` reapplies idempotently, `0002` adds `workflow_status` and backfills existing rows.

- [ ] **Smoke test in browser**

```bash
pnpm dev
```

Verify:
1. `/ingest` shows two badges per source (workflow + hydra).
2. Submit a TechCrunch URL — workflow timeline progresses pending → extracting → judging → complete even if hydra status stays `queued`/`in_progress`.
3. `/wiki/gpt-5` resolves to the GPT-5.5 Instant entity without any manual DB alias row.
4. The entity page shows a synthesized lede instead of "No lede yet."

- [ ] **Run e2e suite**

```bash
pnpm test:e2e
```

Expected: passes. If smoke spec references `failed_upload`/status text that changed, update strings to match new badges.
