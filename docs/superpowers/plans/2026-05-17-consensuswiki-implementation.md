# ConsensusWiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ConsensusWiki, a live multi-source wiki that surfaces established, contested, and single-source claims for AI industry news.

**Architecture:** Next.js App Router owns the UI and server actions. Postgres stores derived application data while HydraDB stores source chunks, graph context, and recall. A workflow-style ingest pipeline normalizes sources, uploads knowledge, extracts claims, judges contradictions, and invalidates cache tags.

**Tech Stack:** Next.js, TypeScript, Tailwind, shadcn/ui-style primitives, Neon/Postgres, Vercel Workflow, Vercel Blob, HydraDB, NVIDIA NIM, Zod, Vitest, MSW, Playwright.

---

## Summary

Use `docs/specs/2026-05-16-consensuswiki-design.md` as source of truth. Use `docs/reference/llm-wiki.md` for the persistent wiki pattern and `docs/reference/wiki-gen-skill.md` for ingest/query/status workflow ideas. Build the full M1-M5 demo path.

## Tasks

- [ ] Scaffold app/tooling and shadcn-style UI primitives.
- [ ] Add schema, migrations, repository functions, demo seed fallback, and pglite tests.
- [ ] Add HydraDB and NIM clients with Zod schemas and mocked tests.
- [ ] Add ingest workflow with URL/PDF input, source normalization, claim extraction, contradiction judging, and cache invalidation.
- [ ] Add dashboard, ingest, entity, graph, query, and saved-query routes.
- [ ] Add integration and E2E coverage for the demo flow.
- [ ] Run full verification and fix failures.

## Acceptance

- `/` shows AI-industry topic stats, entities, and recent sources.
- `/ingest` accepts URL/PDF and shows source status.
- `/wiki/[entity]` groups claims into Established, Contested, and Single-source with citations.
- `/graph` renders entity graph and degrades to a table.
- `/query` synthesizes cited answers and saves `/wiki/q/[slug]`.
- Unit, integration, and E2E tests cover core behavior.
