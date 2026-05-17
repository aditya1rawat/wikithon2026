import { revalidatePath } from "next/cache";
import { demoSavedQueries, demoTopic, stableClaimId, stableSourceId } from "./demo-data";
import { groupClaimsForEntity, normalizeAlias, store } from "./store";
import type { Claim, ClaimRelation, Entity, HydraStatus, Lede, Source, WorkflowStatus } from "./types";

export { groupClaimsForEntity, normalizeAlias, stableClaimId, stableSourceId };

export async function findEntityByAlias(value: string) {
  return store.findEntityByAlias(value);
}

export async function getDashboard() {
  return store.getDashboard();
}

export async function listSources() {
  return store.listSources();
}

export async function getSource(id: string) {
  return store.getSource(id);
}

export async function getSourcesByIds(ids: string[]) {
  return store.getSourcesByIds(ids);
}

export async function getEntityPage(slug: string) {
  return store.getEntityPage(slug);
}

export async function getGraphData() {
  return store.getGraphData();
}

export async function getSavedQuery(slug: string) {
  return store.getSavedQuery(slug);
}

export async function upsertSource(source: Source) {
  const saved = await store.upsertSource(source);
  revalidateTopicViews();
  return saved;
}

export async function updateSourceStatus(id: string, status: HydraStatus) {
  const saved = await store.updateSourceStatus(id, status);
  revalidateTopicViews();
  return saved;
}

export async function updateSourceWorkflowStatus(id: string, status: WorkflowStatus) {
  const saved = await store.updateSourceWorkflowStatus(id, status);
  revalidateTopicViews();
  return saved;
}

export async function upsertEntityWithAliases(input: { entity: Entity; aliases?: string[] }) {
  const entity = await store.upsertEntityWithAliases(input);
  revalidateTopicViews();
  safeRevalidatePath(`/wiki/${entity.id}`);
  return entity;
}

export async function insertClaims(claims: Claim[]) {
  const saved = await store.insertClaims(claims);
  revalidateTopicViews();
  for (const claim of saved) safeRevalidatePath(`/wiki/${claim.entityId}`);
  return saved;
}

export async function insertClaimRelations(relations: ClaimRelation[]) {
  const saved = await store.insertClaimRelations(relations);
  revalidateTopicViews();
  return saved;
}

export async function upsertLede(lede: Lede) {
  const saved = await store.upsertLede(lede);
  safeRevalidatePath(`/wiki/${lede.entityId}`);
  return saved;
}

export async function saveQuery(question: string, answerMd: string, citedSourceIds: string[] = []) {
  const saved = await store.saveQuery(question, answerMd, citedSourceIds);
  safeRevalidatePath(`/wiki/q/${saved.slug}`);
  return saved;
}

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

export async function synthesizeDemoAnswer(question: string) {
  const q = question.toLowerCase();
  if (q.includes("release")) {
    return demoSavedQueries[0].answerMd;
  }
  if (q.includes("benchmark")) {
    return "The benchmark picture is qualified rather than settled. One source reports GPT-5 scored 92.4 on FrontierCode, while another says that score used a non-public benchmark variant. Treat the score as a claim with comparability caveats.";
  }
  return "ConsensusWiki found established claims, contested claims, and single-source claims for this topic. The strongest disagreement currently centers on GPT-5 release timing and benchmark comparability.";
}

function revalidateTopicViews() {
  safeRevalidatePath("/");
  safeRevalidatePath("/ingest");
  safeRevalidatePath("/graph");
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Revalidation is best effort when service helpers run outside a Next request.
  }
}
