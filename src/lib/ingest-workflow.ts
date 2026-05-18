import { revalidatePath, revalidateTag } from "next/cache";
import { registerDemoIngest } from "./app-service";
import { slugify } from "./utils";
import { demoTopic, stableClaimId } from "./demo-data";
import { pollHydraStatus as pollHydraProviderStatus, uploadKnowledge } from "./hydra";
import { canonicalizeEntities, extractClaims, judgeContradictions, synthesizeLede } from "./llm";
import { isValidEntityName } from "./entity-validation";
import { normalizeUrl, type NormalizedSource } from "./normalize-source";
import { store } from "./store";
import type { Claim, ClaimRelation, Entity, HydraStatus, Source, Topic, WorkflowStatus } from "./types";

type WorkflowInput = string | { url: string; topicId?: string };

interface WorkflowContext {
  topic: Topic;
  url: string;
  source: Source;
  normalized: NormalizedSource;
  hydraUpload?: unknown;
  hydraStatus?: { sourceId?: string; status: string; [key: string]: unknown };
  claims?: ExtractedWorkflowClaim[];
  persistedClaims?: Claim[];
  touchedEntityIds?: string[];
  relations?: ClaimRelation[];
}

interface ExtractedWorkflowClaim {
  entity: string;
  claim: string;
  stance: Claim["stance"];
  confidence: number;
  entityId: string;
  evidenceQuote?: string | null;
}

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
  } catch (error) {
    console.error("[ingest] Hydra poll failed, continuing local pipeline:", error);
    await safeUpdateHydraStatus(context.source.id, "errored");
  }
  await safeUpdateWorkflowStatus(context.source.id, "extracting");
  await extractClaimsStep(context);
  await safeUpdateWorkflowStatus(context.source.id, "judging");
  await judgeContradictionsStep(context);
  await synthesizeLedesStep(context);
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

export async function fetchAndNormalize(input: WorkflowInput): Promise<WorkflowContext> {
  const url = typeof input === "string" ? input : input.url;
  const topic = topicFor(typeof input === "string" ? undefined : input.topicId);
  const registered = await registerDemoIngest(url);

  let normalized: NormalizedSource;
  try {
    normalized = await normalizeUrl(url);
  } catch {
    normalized = {
      title: registered.title,
      publisher: registered.publisher,
      publishedAt: registered.publishedAt,
      bodyText: registered.title,
    };
  }

  const source: Source = {
    ...registered,
    topicId: topic.id,
    title: normalized.title || registered.title,
    publisher: normalized.publisher ?? registered.publisher,
    publishedAt: normalized.publishedAt ?? registered.publishedAt,
    hydraStatus: "queued",
    workflowStatus: "pending",
    bodyExcerpt: buildBodyExcerpt(normalized.bodyText),
  };
  await safeUpsertSource(source);
  return { topic, url, source, normalized };
}

export async function hydraUpload(context: WorkflowContext) {
  context.hydraUpload = await uploadKnowledge({
    id: context.source.id,
    subTenantId: context.topic.hydraSubTenantId,
    source: context.normalized.publisher ?? context.source.publisher ?? "unknown",
    title: context.normalized.title,
    url: context.url,
    timestamp: context.normalized.publishedAt,
    text: context.normalized.bodyText,
    metadata: { topic_id: context.topic.id, ingest_run_id: context.source.workflowRunId },
  });
  return context.hydraUpload;
}

export async function pollHydraStatus(context: WorkflowContext) {
  const hydraStatus = await pollHydraProviderStatus(context.source.id, { ceilingMs: 10_000 });
  context.hydraStatus = hydraStatus;
  await safeUpdateHydraStatus(context.source.id, mapProviderStatusToHydraStatus(hydraStatus.status));
  return hydraStatus;
}

export async function extractClaimsStep(context: WorkflowContext) {
  const claims = await extractClaims(context.normalized.bodyText);
  const canonicalEntities = await canonicalizeEntities(claims.map((claim) => claim.entity));
  const canonicalByRaw = new Map(canonicalEntities.map((entity) => [entity.raw, entity]));
  const touchedEntityIds = new Set<string>();
  const persistedClaims: Claim[] = [];
  const workflowClaims: ExtractedWorkflowClaim[] = [];

  for (const claim of claims) {
    const rawEntity = claim.entity.trim();
    if (!rawEntity) continue;
    const canonical = canonicalByRaw.get(rawEntity) ?? canonicalEntities.find((entity) => entity.canonicalName === rawEntity);
    const canonicalName = canonical?.canonicalName ?? rawEntity;
    if (!isValidEntityName(canonicalName)) {
      console.warn(`[ingest] dropping claim with junk entity "${canonicalName}" from ${context.source.id}`);
      continue;
    }
    const aliases = [
      rawEntity,
      canonicalName,
      ...(canonical?.aliases ?? []),
    ];
    const entity = await ensureEntity({
      raw: rawEntity,
      canonicalName,
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
      evidenceQuote: claim.evidenceQuote ?? null,
      extractedAt: new Date().toISOString(),
    });
  }

  if (persistedClaims.length > 0) await store.insertClaims(persistedClaims);
  context.claims = workflowClaims;
  context.persistedClaims = persistedClaims;
  context.touchedEntityIds = [...touchedEntityIds];
  return workflowClaims;
}

export async function judgeContradictionsStep(context: WorkflowContext) {
  const newClaims = context.persistedClaims ?? [];
  const relations: ClaimRelation[] = [];
  const seenPairs = new Set<string>();

  for (const claim of newClaims) {
    const page = await store.getEntityPage(claim.entityId, context.topic.id);
    const candidates = (page?.claims ?? [])
      .filter((candidate) => candidate.id !== claim.id && candidate.entityId === claim.entityId)
      .slice(0, 10);

    for (const candidate of candidates) {
      const pairKey = [claim.id, candidate.id].sort().join(":");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const judgement = await judgeContradictions(claim.claimText, candidate.claimText);
      relations.push({
        claimA: claim.id,
        claimB: candidate.id,
        relation: judgement.relation,
        rationale: judgement.rationale,
        llmConfidence: judgement.confidence,
        judgedAt: new Date().toISOString(),
      });
    }
  }

  if (relations.length > 0) await store.insertClaimRelations(relations);
  context.relations = relations;
  return relations;
}

const LEDE_INTER_CALL_DELAY_MS = 750;

export async function synthesizeLedesStep(context: WorkflowContext) {
  const touched = context.touchedEntityIds ?? [];
  let rateLimited = false;
  for (let i = 0; i < touched.length; i++) {
    if (rateLimited) break;
    const entityId = touched[i];
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/\b429\b/.test(message)) {
        rateLimited = true;
        console.warn(`[ingest] NIM rate limit hit at entity ${entityId}; skipping remaining lede synthesis this run`);
      } else {
        console.warn(`[ingest] lede synthesis or upsert failed for ${entityId}:`, error);
      }
    }
    if (i < touched.length - 1) await sleepMs(LEDE_INTER_CALL_DELAY_MS);
  }
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function invalidateCacheStep(context: WorkflowContext) {
  for (const entityId of context.touchedEntityIds ?? []) {
    safeRevalidateTag(`entity:${entityId}`);
    safeRevalidateTag(`lede:${entityId}`);
  }
  safeRevalidateTag(`topic:${context.topic.id}`);
  safeRevalidateTag(`graph:${context.topic.id}`);
  safeRevalidatePath("/");
  safeRevalidatePath("/ingest");
  safeRevalidatePath("/graph");
}

function topicFor(topicId?: string): Topic {
  if (!topicId || topicId === demoTopic.id) return demoTopic;
  return { ...demoTopic, id: topicId, hydraSubTenantId: `wikithon-${topicId}` };
}

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

async function safeUpsertSource(source: Source) {
  try {
    await store.upsertSource(source);
  } catch {
    // Demo fallback remains usable when the DB worker's store is unavailable.
  }
}

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

function safeRevalidateTag(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // Cache invalidation is best effort in tests and local fallback mode.
  }
}

const BODY_EXCERPT_MAX_CHARS = 1500;

function buildBodyExcerpt(bodyText: string | undefined | null): string | null {
  if (!bodyText) return null;
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= BODY_EXCERPT_MAX_CHARS) return normalized;
  return `${normalized.slice(0, BODY_EXCERPT_MAX_CHARS - 1).trimEnd()}…`;
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Cache invalidation is best effort in tests and local fallback mode.
  }
}

export function mapProviderStatusToHydraStatus(status: string): HydraStatus {
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

