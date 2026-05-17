import { revalidatePath } from "next/cache";
import {
  demoAliases,
  demoClaimRelations,
  demoClaims,
  demoEntities,
  demoLedes,
  demoSavedQueries,
  demoSources,
  demoTopic,
  stableClaimId,
  stableSourceId,
} from "./demo-data";
import type { Claim, ClaimGroups, ClaimRelation, CitedClaim, Entity, EntityPage, GraphData, SavedQuery, Source } from "./types";

const runtimeSources: Source[] = [...demoSources];
const runtimeClaims: Claim[] = [...demoClaims];
const runtimeRelations: ClaimRelation[] = [...demoClaimRelations];
const runtimeSavedQueries: SavedQuery[] = [...demoSavedQueries];

export { stableClaimId, stableSourceId };

export function normalizeAlias(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function findEntityByAlias(value: string) {
  const normalized = normalizeAlias(value);
  return (
    demoEntities.find((entity) => normalizeAlias(entity.id) === normalized || normalizeAlias(entity.canonicalName) === normalized) ??
    demoEntities.find((entity) => demoAliases.some((alias) => alias.entityId === entity.id && normalizeAlias(alias.alias) === normalized)) ??
    null
  );
}

export async function getDashboard() {
  const contradictions = runtimeRelations.filter((relation) => relation.relation === "contradict").length;
  const entities = demoEntities.map((entity) => {
    const entityClaims = runtimeClaims.filter((claim) => claim.entityId === entity.id);
    const claimIds = new Set(entityClaims.map((claim) => claim.id));
    return {
      ...entity,
      claimCount: entityClaims.length,
      contestedCount: runtimeRelations.filter((relation) => relation.relation === "contradict" && (claimIds.has(relation.claimA) || claimIds.has(relation.claimB))).length,
    };
  });

  return {
    topic: demoTopic,
    stats: { entities: demoEntities.length, claims: runtimeClaims.length, sources: runtimeSources.length, contradictions },
    entities,
    sources: [...runtimeSources].sort(sortByPublishedAtDesc).slice(0, 6),
  };
}

export async function listSources() {
  return [...runtimeSources].sort(sortByPublishedAtDesc);
}

export async function getEntityPage(slug: string): Promise<EntityPage | null> {
  const entity = findEntityByAlias(slug);
  if (!entity) return null;
  const claims = runtimeClaims
    .filter((claim) => claim.entityId === entity.id)
    .map((claim) => ({ ...claim, source: runtimeSources.find((source) => source.id === claim.sourceId)! }))
    .filter((claim) => claim.source);
  const claimIds = new Set(claims.map((claim) => claim.id));
  const relations = runtimeRelations.filter((relation) => claimIds.has(relation.claimA) || claimIds.has(relation.claimB));
  const sourceIds = new Set(claims.map((claim) => claim.sourceId));
  const sources = runtimeSources.filter((source) => sourceIds.has(source.id)).sort(sortByPublishedAtDesc);
  return {
    topic: demoTopic,
    entity,
    aliases: demoAliases.filter((alias) => alias.entityId === entity.id),
    lede: demoLedes.find((lede) => lede.entityId === entity.id) ?? null,
    sources,
    claims,
    relations,
    groups: groupClaimsForEntity({ entity, claims: runtimeClaims, sources: runtimeSources, relations: runtimeRelations }),
    timeline: sources,
  };
}

export function groupClaimsForEntity({
  entity,
  claims,
  sources,
  relations,
}: {
  entity: Entity;
  claims: Claim[];
  sources: Source[];
  relations: ClaimRelation[];
}): ClaimGroups {
  const citedClaims = claims
    .filter((claim) => claim.entityId === entity.id)
    .map((claim) => ({ ...claim, source: sources.find((source) => source.id === claim.sourceId)! }))
    .filter((claim): claim is CitedClaim => Boolean(claim.source));
  const byId = new Map(citedClaims.map((claim) => [claim.id, claim]));
  const sourceCounts = new Map<string, number>();
  for (const claim of citedClaims) sourceCounts.set(claim.claimText, (sourceCounts.get(claim.claimText) ?? 0) + 1);
  const contestedIds = new Set<string>();
  const seenPairs = new Set<string>();
  const contested = citedClaims.flatMap((claim) => {
    const claimRelations = relations.filter(
      (relation) => relation.relation === "contradict" && (relation.claimA === claim.id || relation.claimB === claim.id)
    );
    const freshRelations = claimRelations.filter((relation) => {
      const key = [relation.claimA, relation.claimB].sort().join(":");
      if (seenPairs.has(key)) return false;
      seenPairs.add(key);
      return true;
    });
    if (freshRelations.length === 0) return [];
    contestedIds.add(claim.id);
    const opposingClaims = freshRelations
      .map((relation) => byId.get(relation.claimA === claim.id ? relation.claimB : relation.claimA))
      .filter((item): item is CitedClaim => Boolean(item));
    for (const opposing of opposingClaims) contestedIds.add(opposing.id);
    return [{ claim, opposingClaims, relations: freshRelations }];
  });
  const established = citedClaims.filter((claim) => !contestedIds.has(claim.id) && ((sourceCounts.get(claim.claimText) ?? 0) >= 2 || relations.some((relation) => relation.relation === "agree" && (relation.claimA === claim.id || relation.claimB === claim.id))));
  const establishedIds = new Set(established.map((claim) => claim.id));
  const singleSource = citedClaims.filter((claim) => !contestedIds.has(claim.id) && !establishedIds.has(claim.id));
  return { established, contested, singleSource };
}

export async function getGraphData(): Promise<GraphData> {
  const nodes = demoEntities.map((entity) => ({
    id: entity.id,
    label: entity.canonicalName,
    type: entity.entityType,
    claimCount: runtimeClaims.filter((claim) => claim.entityId === entity.id).length,
  }));
  const claimToEntity = new Map(runtimeClaims.map((claim) => [claim.id, claim.entityId]));
  const edges = runtimeRelations
    .map((relation, index) => {
      const source = claimToEntity.get(relation.claimA);
      const target = claimToEntity.get(relation.claimB);
      if (!source || !target || source === target) return null;
      return {
        id: `${relation.relation}-${index}`,
        source,
        target,
        relation: relation.relation,
        label: relation.relation,
        rationale: relation.rationale,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
  return { topic: demoTopic, nodes, edges };
}

export async function getSavedQuery(slug: string) {
  return runtimeSavedQueries.find((query) => query.slug === slug || query.id === slug) ?? null;
}

export async function saveQuery(question: string, answerMd: string, citedSourceIds: string[] = []) {
  const slug = slugify(question).slice(0, 64) || `query-${Date.now()}`;
  const saved: SavedQuery = {
    id: slug,
    topicId: demoTopic.id,
    slug,
    question,
    answerMd,
    citedSourceIds,
    savedAt: new Date().toISOString(),
  };
  runtimeSavedQueries.unshift(saved);
  revalidatePath(`/wiki/q/${slug}`);
  return saved;
}

export async function registerDemoIngest(url: string, title?: string) {
  const id = stableSourceId(demoTopic.id, url);
  const existing = runtimeSources.find((source) => source.id === id);
  if (existing) return existing;
  const source: Source = {
    id,
    topicId: demoTopic.id,
    url,
    title: title || `Live source: ${new URL(url).hostname}`,
    publisher: new URL(url).hostname.replace(/^www\./, ""),
    publishedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    hydraStatus: "queued",
    workflowRunId: `local-${Date.now()}`,
  };
  runtimeSources.unshift(source);
  revalidatePath("/");
  revalidatePath("/ingest");
  return source;
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

function sortByPublishedAtDesc(a: Source, b: Source) {
  return Date.parse(b.publishedAt ?? b.ingestedAt) - Date.parse(a.publishedAt ?? a.ingestedAt);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
