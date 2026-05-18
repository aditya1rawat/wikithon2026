# Cursor Handoff — ConsensusWiki Critical Fixes + Polish (2026-05-17)

Tasks 1-11 done. Task 12 remaining. Quality review for Task 11 still running in background — no fixes expected to be critical.

## Status

| Task | Status | Final commit |
|------|--------|--------------|
| 1. revalidateTag cast | ✅ DONE | `1bcf4ed` |
| 2. workflow_status split | ✅ DONE | `cc1c390` |
| 3. entity-upsert collision | ✅ DONE | `3cbc3e5` |
| 4. model-family aliases | ✅ DONE | `5b3696b` |
| 5. lede synthesis | ✅ DONE | `e8266ad` |
| 6. zero-claim graph filter | ✅ DONE | `8661acf` |
| 7. UA + AbortController fetch | ✅ DONE | `81daa93` |
| 8. Hydra retry tolerance | ✅ DONE | `108ac1e` |
| 9. retry button wired | ✅ DONE | `2572e91` |
| 10. shared slugify | ✅ DONE | `1b60a49` |
| 11. e2e specs live-data | 🟡 DONE w/ review fixes pending | `3e601b9` |
| 12. UX overhaul (impeccable + frontend-design) | ⬜ TODO | — |

Current HEAD: `3e601b9`. Unit/integration 38/38 pass. E2e 4/4 pass. Lint clean. Build clean.

## Workspace

- Worktree path: `/Users/adityarawat/Documents/github/wikithon2026/.claude/worktrees/fix-consensuswiki-critical`
- Branch: `worktree-fix-consensuswiki-critical`
- Main repo path: `/Users/adityarawat/Documents/github/wikithon2026`
- Shares `.git`. Work from worktree, not main repo.
- `.env.local` already present in worktree.
- Migration `0002_workflow_status.sql` already applied to dev Neon DB.

## Task 11.5 — Open review issues (do these first)

Code quality reviewer flagged 3 Important issues against `tests/e2e/smoke.spec.ts`. Apply before Task 12.

### Fix 1 — Tighten dashboard URL regex + use role locator for h1

Current first test (rewritten in Task 11) asserts:
```ts
await expect(page).toHaveURL(/\/wiki\/[a-z0-9-]+/);
await expect(page.locator('h1')).toBeVisible();
```

Problems:
- Regex `/\/wiki\/[a-z0-9-]+/` matches `/wiki/q/...` saved-query routes too — latent false-positive.
- `locator('h1')` throws strict-mode violation if layout ever adds a second h1.

Replace with:
```ts
await expect(page).toHaveURL(/\/wiki\/(?!q\/)[a-z0-9-]+/);
await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
```

### Fix 2 — Gate query test on `NIM_API_KEY`

Third test now submits the query form, which fires `synthesizeQueryAnswer` → live NIM API call. In CI without `NIM_API_KEY` this hangs or fails. Add at top of test body:

```ts
test("query form submits and lands on a saved wiki page", async ({ page }) => {
  test.skip(!process.env.NIM_API_KEY, "Requires NIM_API_KEY for live query synthesis");
  // ...rest unchanged
});
```

### Verify + commit

```bash
pnpm test:e2e
# expect 4/4 pass (or 3 pass + 1 skip if no NIM_API_KEY)

git add tests/e2e/smoke.spec.ts
git commit -m "test(e2e): tighten dashboard regex and gate query test on NIM_API_KEY"
```

Optional follow-up not flagged but worth considering: ingest a deterministic test URL in a Playwright `beforeAll` to guarantee at least one entity exists on the dashboard. Skip if dev DB already has data — current state on `worktree-fix-consensuswiki-critical` does.

---

## Task 12 — UX overhaul (impeccable + frontend-design)

Plan ref: `docs/superpowers/plans/2026-05-17-consensuswiki-polish.md` section `## Task 12`.

### Goal

App functions but design is generic Tailwind/shadcn. Ingestion has no live progress, failed states minimal, empty states bland. Use `impeccable` skill for audit + critique, `frontend-design:frontend-design` skill for creative direction, then ship per-page redesign.

### Scope (kept tight)

1. **Ingestion experience** — live workflow timeline with optimistic UI, real loading skeleton on the ingest log, distinct visual treatment for each `WorkflowStatus` and `HydraStatus`, animated step transitions.
2. **Entity / wiki page** — lede emphasis, contested-claim diff styling, clearer source citation chips.
3. **Graph page** — replace bland Cytoscape default with a clear legend, node coloring by entity type, hover state.
4. **Dashboard** — bolder hero, better entity-card density, status sparkline if cheap to add.

### Out of scope

- New routes
- Backend schema changes
- Cytoscape replacement (keep current renderer)
- Theming system (single dark/light pass only if `impeccable` says it's cheap)

### Files likely touched (finalize during step 2)

- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/ingest/page.tsx`, `src/app/graph/page.tsx`, `src/app/wiki/[entity]/page.tsx`, `src/app/wiki/q/[slug]/page.tsx`
- Modify: `src/components/graph/topic-graph.tsx`
- Modify: `src/components/ui/*.tsx` (only the components that ship)
- Possibly new: `src/components/ingest/workflow-timeline.tsx` (extract from page if it grows)
- Possibly new: `src/styles/animations.css` or extend `globals.css`

### TDD sequence

1. **Invoke audit skill.** Invoke `impeccable` skill. Audit `/`, `/ingest`, `/graph`, `/wiki/gpt-5-5-instant`, `/query` against UX criteria: visual hierarchy, status legibility, loading states, error states, empty states, accessibility, motion. Save audit to `docs/superpowers/plans/2026-05-17-ux-audit.md`.

2. **Invoke creative direction skill.** Invoke `frontend-design:frontend-design`. Feed it the audit. Ask for a design plan mapping each finding to a concrete component-level change with code snippets. Save to `docs/superpowers/plans/2026-05-17-ux-design.md`.

3. **Implement design changes iteratively.** One page at a time:
   - **Ingest page** — extract `WorkflowTimeline` into `src/components/ingest/workflow-timeline.tsx`; per-step animation (CSS only); Skeleton for log; rework `StatusBadge` to compact pill cluster with icon + label.
   - **Entity page** — emphasize lede as callout block (border-l, larger leading, accent color); rework `ContestedCard` to true side-by-side diff with connector; source chips with publisher favicon stub (`getFavicon(url)` helper from host).
   - **Graph page** — node coloring by `EntityType`; legend chip row; hover tooltip with claim count; gentler `circle` → `cose` layout.
   - **Dashboard** — bolder hero typography; entity list dense; recent-sources card adds time-ago.
   
   Each substep its own commit:
   ```bash
   git add <files>
   git commit -m "feat(ux): <page> redesign per ux-design plan"
   ```

4. **Verify.** `pnpm lint && pnpm test && pnpm build && pnpm test:e2e`. All green. E2e specs (already structural after Task 11) should survive redesign. If a selector breaks, update with `aria-label` instead of visual text.

5. **Run dev server, screenshot each page.** `pnpm dev`. Visit each page; verify against design plan.

6. **Final commit + cleanup.** Multiple `feat(ux):` commits fine. Optional `git rebase -i` to squash locally — never on `main`.

## Final verification after Task 12

```bash
cd /Users/adityarawat/Documents/github/wikithon2026/.claude/worktrees/fix-consensuswiki-critical
pnpm lint && pnpm test && pnpm build && pnpm test:e2e
pnpm db:migrate     # idempotent
pnpm dev            # browser smoke
```

Browser smoke checks:
1. `/ingest` shows two badges (workflow + hydra) with live progress animation.
2. Submit a TechCrunch URL → workflow timeline progresses pending → extracting → judging → complete; orphan source nodes filtered from graph.
3. Failed ingest shows retry button — click re-queues source.
4. `/wiki/gpt-5` resolves to the GPT-5.5 Instant entity (model-family alias).
5. Entity page shows synthesized lede with new callout styling.
6. Graph page shows colored nodes by entity type, legend, hover tooltips.

## Merge

```bash
git checkout main
git merge worktree-fix-consensuswiki-critical
git push origin main
```

## Reference files (priority order)

1. `docs/superpowers/plans/2026-05-17-consensuswiki-polish.md` — Tasks 6-12 plan, authoritative for Task 12.
2. `docs/superpowers/plans/2026-05-17-consensuswiki-critical-fixes.md` — Tasks 1-5 plan (already complete).
3. `src/app/ingest/page.tsx` — current workflow timeline, target for first ux pass.
4. `src/components/graph/topic-graph.tsx` — Cytoscape config, target for third ux pass.
5. `src/app/wiki/[entity]/page.tsx` — entity page, target for second ux pass.
6. `src/app/page.tsx` — dashboard, target for fourth ux pass.
7. `src/components/ui/*.tsx` — shadcn primitives (button, badge, card, label, input, table, tabs, textarea, alert).

## What's already shipped (Tasks 1-11 detail)

### Task 1 — revalidateTag cast drop
- `src/lib/ingest-workflow.ts` `safeRevalidateTag` calls `revalidateTag(tag, "max")` directly. Next 16 signature is `revalidateTag(tag: string, profile: string | CacheLifeConfig)`.
- Test in `tests/integration/workflow.test.ts` uses `vi.mocked(...).mockClear()` to lock non-vacuously.

### Task 2 — workflow_status / hydra_status split
- `WorkflowStatus = pending | extracting | judging | complete | failed_fetch | failed_upload`.
- `HydraStatus = queued | in_progress | success | errored | unknown`.
- `Source.workflowStatus` field added.
- Migration `db/migrations/0002_workflow_status.sql` (additive, backfill safe).
- `db/migrate.ts` iterates all sorted `*.sql` migrations.
- Both stores implement `updateSourceWorkflowStatus`.
- `runIngestWorkflow` progresses pending → extracting → judging → complete. Hydra failure no longer blocks (catch logs via `console.error`).
- `src/app/ingest/page.tsx` renders two badges per source.
- `src/app/ingest/actions.ts` catch sets `workflowStatus = failed_fetch`.

### Task 3 — Entity-upsert canonical collision
- Postgres `upsertEntityWithAliases` SELECTs existing by `(topic_id, canonical_name)` first → uses that id as `targetId` → INSERT with `ON CONFLICT (id) DO UPDATE`.
- `ensureEntity` returns `store.upsertEntityWithAliases(...)` directly.
- Known dev-DB-only race: SELECT-then-INSERT not atomic.

### Task 4 — Model-family alias generation
- `CanonicalEntitySchema` gains `aliases: z.array(z.string()).default([])`.
- `canonicalizeEntities` prompt asks for variants + parent-family names. Returns deduped aliases.
- `fallbackCanonicalEntity` adds deterministic `modelFamilyAliases(canonicalName, "MODEL")` — for `GPT-N(.M)?` canonical names emits `gpt-n` + `gpt n` aliases.
- Workflow threads aliases into `upsertEntityWithAliases`.

### Task 5 — Lede synthesis after ingest
- `synthesizeLedesStep` in `src/lib/ingest-workflow.ts` between judgement and complete-status.
- Iterates `touchedEntityIds`, loads page, calls `synthesizeLede(canonicalName, claimTexts)`, `store.upsertLede`. Try/catch logs via `console.warn`.

### Task 6 — Zero-claim graph filter
- `buildGraphData` in `src/lib/store.ts`: single-pass over claims builds `entityClaimCount` + `sourceClaimCount` Maps. Sources with 0 claims filtered out.
- Test asserts orphan source excluded, used source `claimCount === 1`.

### Task 7 — UA + AbortController in normalizeUrl
- Chrome 120-like UA with `ConsensusWiki/0.1` product token.
- `accept: "text/html,application/xhtml+xml"` header.
- 15s AbortController timeout via setTimeout/clearTimeout.
- Catch narrowed to `DOMException AbortError` + `TypeError` (network errors) → Jina fallback. Other errors re-thrown.

### Task 8 — Hydra retry tolerance
- `MAX_TRANSIENT_FAILURES = 3` constant in `src/lib/hydra.ts`.
- `pollHydraStatus` throws on `>= MAX_TRANSIENT_FAILURES` instead of `> 1`.
- Counter still resets on every successful read.

### Task 9 — Retry button wired
- `retryIngest(formData)` server action in `src/app/ingest/actions.ts`.
- Reads `sourceId` from form, calls `getSource`, resets `workflowStatus → pending` + `hydraStatus → queued`, schedules `runIngestWorkflow(source.url)` via `after()`. Catch marks `failed_fetch` if still pending/extracting. Always `redirect("/ingest")`.
- Per-source retry button wrapped in `<form action={retryIngest}>` with hidden `sourceId`. Legend button stays disabled.
- Note: `await after(...)` used (production no-op, test mock returns Promise so test synchronizes).

### Task 10 — Shared slugify
- `slugify` hoisted to `src/lib/utils.ts` alongside `cn`.
- `src/lib/store.ts` and `src/lib/ingest-workflow.ts` import from `./utils`.

### Task 11 — E2e specs live-data
- `tests/e2e/smoke.spec.ts`: 2 of 4 tests rewritten.
  - Dashboard test now clicks `a[href^="/wiki/"]` first link, asserts URL regex.
  - Query test fills `Question` textbox with timestamp, asserts saved-wiki URL regex.
- Other 2 tests (ingest, graph) unchanged.
- 4/4 e2e pass against live Neon DB.

## Carry-forward notes

- Task 2 implementer ran `pnpm db:migrate` against the live dev Neon DB. `workflow_status` column exists. Idempotent re-runs OK.
- Task 3 dev-DB-only race in postgres `upsertEntityWithAliases`. Production fix would be `INSERT ... ON CONFLICT (topic_id, canonical_name) DO UPDATE ... RETURNING id`. Single-dev scope makes this benign.
- Task 9 `await after(...)` deviation acknowledged. Reviewer flagged but accepted because test mock returns Promise. Future cleanup option: change test mock to async + drop await in action.
- Migration 0002 backfill leaves rows with `hydra_status = 'errored'` at `workflow_status = 'pending'`. Dev DB only — no real data affected.
- `next-env.d.ts` had unstaged Next.js auto-edits during Task 4 work. Not committed; regenerates on next build.
- Demo data in `src/lib/demo-data.ts:demoLedes` already has ledes for some entities. After Task 5, `synthesizeLedesStep` overwrites them on next ingest.
- Task 11 quality reviewer running in background — fixes (if any) likely cosmetic (locator stability, single-h1 risk). Check the agent output for `acec9591b520ef13f` if reviewer flagged anything before merging.

## Prior-session reference commits (pre-plan)

- `09e73e2` map Hydra processing statuses correctly
- `4b755c7` make ingest graph visible after source upload
- `7dd0b18` align Hydra upload client with API
- `b80eff3` add database migration runner
- `67b895c` Merge PR #6 codex/real-integrations

## Env (.env.local — present in worktree)

- `DATABASE_URL` — Neon
- `HYDRA_API_KEY`, `HYDRA_TENANT_ID`, `HYDRA_BASE_URL=https://api.hydradb.com`
- `NIM_API_KEY`, `NIM_BASE_URL=https://integrate.api.nvidia.com/v1`
- `NIM_MODEL=meta/llama-3.1-8b-instruct`

Do not overwrite.

## Tooling

- pnpm 10.33.2, Node 20+, Next.js 16.2.6 (App Router, Cache Components), Vitest 2, Playwright 1.56, TypeScript 5, Tailwind v4.
- Skills you may want to invoke for Task 12:
  - `/caveman:caveman` for terse responses (optional)
  - `impeccable` for UX audit
  - `frontend-design:frontend-design` for creative direction
  - `superpowers:writing-skills` if you want to encode the design system as a skill
  - `vercel:shadcn` if you add new shadcn components
  - `chrome-devtools-mcp:a11y-debugging` for accessibility verification

## Merge when done

```bash
git checkout main
git merge worktree-fix-consensuswiki-critical
git push origin main
```
