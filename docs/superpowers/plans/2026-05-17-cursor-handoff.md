# Cursor Handoff — ConsensusWiki Critical Fixes (2026-05-17)

Tasks 1-4 done. Task 5 remaining. Pick up from worktree.

## Status

| Task | Status | Commit |
|------|--------|--------|
| 1. revalidateTag cast | ✅ DONE | `0436d75` + `1bcf4ed` |
| 2. workflow_status split | ✅ DONE | `4e9ea2a` + `cc1c390` |
| 3. entity-upsert collision | ✅ DONE | `cd4793e` + `3cbc3e5` |
| 4. model-family aliases | ✅ DONE | `5b3696b` |
| 5. Lede synthesis | ⬜ TODO | — |

Current HEAD: `5b3696b`. 31/31 tests pass. Lint clean.

## Workspace

- Worktree path: `/Users/adityarawat/Documents/github/wikithon2026/.claude/worktrees/fix-consensuswiki-critical`
- Branch: `worktree-fix-consensuswiki-critical`
- Main repo path: `/Users/adityarawat/Documents/github/wikithon2026`
- Both share `.git`. Work from worktree, not main repo.
- `.env.local` already present in worktree.
- Migration `0002_workflow_status.sql` already applied to dev Neon DB.

## Task 5 — Lede synthesis after ingest

Plan ref: `docs/superpowers/plans/2026-05-17-consensuswiki-critical-fixes.md` section `## Task 5`.

### Goal

Entity pages currently show "No lede yet." because the workflow never calls `synthesizeLede` even though `llm.ts` defines it and `store.upsertLede` exists. Add a workflow step.

### Changes

**1. `src/lib/ingest-workflow.ts`**

Add `synthesizeLede` to the `./llm` import (currently imports `canonicalizeEntities`, `extractClaims`, `judgeContradictions`).

Add new step function:

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

Insert call inside `runIngestWorkflow` between `judgeContradictionsStep` and `safeUpdateWorkflowStatus(..., "complete")`. Sequence becomes:

```ts
await safeUpdateWorkflowStatus(context.source.id, "judging");
await judgeContradictionsStep(context);
await synthesizeLedesStep(context);
await safeUpdateWorkflowStatus(context.source.id, "complete");
await invalidateCacheStep(context);
```

**2. `tests/integration/workflow.test.ts`** — add test:

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

### TDD sequence

1. Add test → `pnpm test -- tests/integration/workflow.test.ts` → expect FAIL (`page.lede` is null).
2. Add `synthesizeLedesStep` + import + call site.
3. `pnpm test` → expect 32/32 pass.
4. `pnpm lint && pnpm build` → expect clean.
5. Commit:

```bash
git add src/lib/ingest-workflow.ts tests/integration/workflow.test.ts
git commit -m "feat: synthesize lede for every touched entity after ingest

After judgement, iterate touched entity ids, load each entity page,
call synthesizeLede with the canonical name + claim texts, and
upsert the result. Errors are swallowed so the entity page still
renders with no lede."
```

## Final verification after Task 5

```bash
cd /Users/adityarawat/Documents/github/wikithon2026/.claude/worktrees/fix-consensuswiki-critical
pnpm lint && pnpm test && pnpm build
pnpm db:migrate     # idempotent
pnpm dev            # browser smoke
```

Browser smoke checks:

1. `/ingest` shows two badges per source (workflow + hydra).
2. Submit a TechCrunch URL → workflow timeline progresses pending → extracting → judging → complete even if hydra status stays queued/in_progress.
3. `/wiki/gpt-5` resolves to the GPT-5.5 Instant entity without any manual DB alias row.
4. Entity page shows synthesized lede instead of "No lede yet."

```bash
pnpm test:e2e
```

If smoke spec asserts old badge text (`failed_upload` regex still matches new `workflow: failed_upload` badge — should still pass), update strings if anything breaks.

## Merge

```bash
git checkout main
git merge worktree-fix-consensuswiki-critical
git push origin main
```

## Reference files (priority order)

1. `docs/superpowers/plans/2026-05-17-consensuswiki-critical-fixes.md` — full implementation plan, authoritative for Task 5.
2. `src/lib/ingest-workflow.ts` — `synthesizeLedesStep` goes here.
3. `src/lib/llm.ts` — `synthesizeLede` defined at line ~136. Returns string.
4. `src/lib/store.ts` — `upsertLede` (memory + postgres paths exist).
5. `src/lib/types.ts` — `Lede` shape.
6. `tests/integration/workflow.test.ts` — TDD pattern; mocks `next/cache` via `vi.mock`.

## What's already shipped (Tasks 1-4 detail)

### Task 1 — revalidateTag cast drop

- `src/lib/ingest-workflow.ts` `safeRevalidateTag` calls `revalidateTag(tag, "max")` directly. Next 16 signature is `revalidateTag(tag: string, profile: string | CacheLifeConfig)`.
- New test `tests/integration/workflow.test.ts` uses `vi.mocked(cache.revalidateTag).mockClear()` to lock non-vacuously.
- Commits: `0436d75` + `1bcf4ed`.

### Task 2 — workflow_status / hydra_status split

- New type `WorkflowStatus = pending | extracting | judging | complete | failed_fetch | failed_upload`.
- `HydraStatus` shrunk to `queued | in_progress | success | errored | unknown`.
- `Source.workflowStatus` field added.
- Migration `db/migrations/0002_workflow_status.sql` (additive, backfill safe).
- `db/migrate.ts` iterates all sorted `*.sql` migrations.
- Both stores (memory + postgres) implement `updateSourceWorkflowStatus`.
- `runIngestWorkflow` progresses pending → extracting → judging → complete. Hydra failure no longer blocks (catch logs via `console.error` and continues).
- `src/app/ingest/page.tsx` renders two badges per source.
- `src/app/ingest/actions.ts` catch sets `workflowStatus = failed_fetch`.
- Tests added: `"persists separate hydra and workflow statuses"` (store), `"hydra timeout does not block local workflow_status = complete"` (workflow).
- Commits: `4e9ea2a` + `cc1c390`.

### Task 3 — Entity-upsert canonical collision

- Postgres `upsertEntityWithAliases` SELECTs existing by `(topic_id, canonical_name)` first → uses that id as `targetId` → INSERT with `ON CONFLICT (id) DO UPDATE`. Avoids unhandled `UNIQUE` violation when slug-id mints differ but canonical name matches.
- `ensureEntity` returns `store.upsertEntityWithAliases(...)` directly instead of pre-constructed local copy.
- Tests added in `tests/integration/store.test.ts`: canonical collapse + alias-registration via unique alias `"gpt 5 alpha"`.
- Commits: `cd4793e` + `3cbc3e5`.

### Task 4 — Model-family alias generation

- `CanonicalEntitySchema` gains `aliases: z.array(z.string()).default([])`.
- `canonicalizeEntities` prompt asks for variants + parent-family names. Returns deduped aliases.
- `fallbackCanonicalEntity` adds deterministic `modelFamilyAliases(canonicalName, "MODEL")` — for `GPT-N(.M)?` canonical names emits `gpt-n` + `gpt n` aliases.
- `ensureEntity` signature gains `aliases: string[]`.
- `extractClaimsStep` threads `[rawEntity, canonical?.canonicalName, ...canonical?.aliases]` into `ensureEntity` → `upsertEntityWithAliases`.
- Tests added: `tests/unit/llm.test.ts` (2: fallback family + live NIM aliases), `tests/integration/store.test.ts` (1: model-family alias resolves).
- Commit: `5b3696b`.

## Carry-forward notes

- Task 2 implementer ran `pnpm db:migrate` against the live dev Neon DB. `workflow_status` column exists in production sources table. Idempotent re-runs OK.
- Task 3 has a dev-DB-only race in postgres `upsertEntityWithAliases`: SELECT-then-INSERT not atomic. Two concurrent ingests of same canonical name can both miss SELECT and one trips `UNIQUE (topic_id, canonical_name)`. Production fix would be one-statement `INSERT ... ON CONFLICT (topic_id, canonical_name) DO UPDATE SET id = id RETURNING id`. Single-dev scope makes this benign.
- Task 3 `ensureEntity`: pre-lookup via `findEntityByAlias` is now redundant after store's canonical-collision fix. Removable but harmless. Don't refactor in Task 5.
- Migration 0002 backfill leaves rows with `hydra_status = 'errored'` at `workflow_status = 'pending'`. Dev DB only — no real data affected.
- `next-env.d.ts` had unstaged Next.js auto-edits during Task 4 work. Not committed; regenerates on next build.
- Demo data in `src/lib/demo-data.ts:demoLedes` already has ledes for some entities (gpt-5, openai, anthropic). After Task 5 lands, `synthesizeLedesStep` will overwrite them on next ingest of related sources. That's fine.

## Prior-session reference commits (pre-plan)

These predate the critical-fixes plan but explain how Hydra/NIM/migration arrived at current shape:

- `09e73e2` map Hydra processing statuses correctly
- `4b755c7` make ingest graph visible after source upload
- `7dd0b18` align Hydra upload client with API
- `b80eff3` add database migration runner
- `67b895c` Merge PR #6 codex/real-integrations

## Env (.env.local — already present in worktree)

- `DATABASE_URL` — Neon
- `HYDRA_API_KEY`, `HYDRA_TENANT_ID`, `HYDRA_BASE_URL=https://api.hydradb.com`
- `NIM_API_KEY`, `NIM_BASE_URL=https://integrate.api.nvidia.com/v1`
- `NIM_MODEL=meta/llama-3.1-8b-instruct`

Do not overwrite.
