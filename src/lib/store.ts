import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { slugify } from "./utils";
import {
  demoAliases,
  demoClaimRelations,
  demoClaims,
  demoEntities,
  demoLedes,
  demoSavedQueries,
  demoSources,
  demoTopic,
} from "./demo-data";
import type {
  Claim,
  ClaimGroups,
  ClaimRelation,
  CitedClaim,
  DashboardData,
  Entity,
  EntityAlias,
  EntityPage,
  GraphData,
  HydraStatus,
  Lede,
  QueryGraphContext,
  SavedQuery,
  Source,
  Topic,
  WorkflowStatus,
} from "./types";

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

export interface ConsensusStore {
  upsertTopic(topic: Topic): Promise<Topic>;
  getDashboard(topicId?: string): Promise<DashboardData>;
  getSource(id: string): Promise<Source | null>;
  getSourcesByIds(ids: string[]): Promise<Source[]>;
  listSources(topicId?: string): Promise<Source[]>;
  findEntityByAlias(value: string, topicId?: string): Promise<Entity | null>;
  getEntityPage(slug: string, topicId?: string): Promise<EntityPage | null>;
  getGraphData(topicId?: string): Promise<GraphData>;
  getSavedQuery(slugOrId: string): Promise<SavedQuery | null>;
  listSavedQueries(limit?: number): Promise<SavedQuery[]>;
  saveQuery(question: string, answerMd: string, citedSourceIds?: string[], topicId?: string, graphContext?: QueryGraphContext | null): Promise<SavedQuery>;
  upsertSource(source: Source): Promise<Source>;
  updateSourceStatus(id: string, status: HydraStatus): Promise<Source | null>;
  updateSourceWorkflowStatus(id: string, status: WorkflowStatus): Promise<Source | null>;
  upsertEntityWithAliases(input: { entity: Entity; aliases?: string[] }): Promise<Entity>;
  insertClaims(claims: Claim[]): Promise<Claim[]>;
  insertClaimRelations(relations: ClaimRelation[]): Promise<ClaimRelation[]>;
  upsertLede(lede: Lede): Promise<Lede>;
}

interface StoreSnapshot {
  topic: Topic;
  sources: Source[];
  entities: Entity[];
  aliases: EntityAlias[];
  claims: Claim[];
  relations: ClaimRelation[];
  ledes: Lede[];
}

export function createStore(): ConsensusStore {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return createPostgresStore(databaseUrl);
  return createMemoryStore();
}

export function createMemoryStore(options: { seedDemoData?: boolean; now?: () => Date } = {}): ConsensusStore {
  const seedDemoData = options.seedDemoData ?? true;
  const now = options.now ?? (() => new Date());
  const topics = seedDemoData ? [cloneTopic(demoTopic)] : [];
  const sources = seedDemoData ? demoSources.map(cloneSource) : [];
  const entities = seedDemoData ? demoEntities.map(cloneEntity) : [];
  const aliases = seedDemoData ? demoAliases.map(cloneAlias) : [];
  const claims = seedDemoData ? demoClaims.map(cloneClaim) : [];
  const relations = seedDemoData ? demoClaimRelations.map(cloneRelation) : [];
  const ledes = seedDemoData ? demoLedes.map(cloneLede) : [];
  const savedQueries = seedDemoData ? demoSavedQueries.map(cloneSavedQuery) : [];

  function topicFor(topicId = demoTopic.id) {
    return topics.find((topic) => topic.id === topicId) ?? cloneTopic(demoTopic);
  }

  function snapshot(topicId = demoTopic.id): StoreSnapshot {
    const topicEntities = entities.filter((entity) => entity.topicId === topicId);
    const entityIds = new Set(topicEntities.map((entity) => entity.id));
    const topicClaims = claims.filter((claim) => entityIds.has(claim.entityId));
    const claimIds = new Set(topicClaims.map((claim) => claim.id));
    return {
      topic: topicFor(topicId),
      sources: sources.filter((source) => source.topicId === topicId).map(cloneSource),
      entities: topicEntities.map(cloneEntity),
      aliases: aliases.filter((alias) => entityIds.has(alias.entityId)).map(cloneAlias),
      claims: topicClaims.map(cloneClaim),
      relations: relations.filter((relation) => claimIds.has(relation.claimA) || claimIds.has(relation.claimB)).map(cloneRelation),
      ledes: ledes.filter((lede) => entityIds.has(lede.entityId)).map(cloneLede),
    };
  }

  return {
    async upsertTopic(topic) {
      const existingIndex = topics.findIndex((item) => item.id === topic.id);
      const next = cloneTopic(topic);
      if (existingIndex >= 0) topics[existingIndex] = next;
      else topics.push(next);
      return cloneTopic(next);
    },
    async getDashboard(topicId = demoTopic.id) {
      return buildDashboard(snapshot(topicId));
    },
    async getSource(id) {
      const source = sources.find((item) => item.id === id);
      return source ? cloneSource(source) : null;
    },
    async getSourcesByIds(ids) {
      const byId = new Map(sources.map((source) => [source.id, source]));
      return ids.map((id) => byId.get(id)).filter((source): source is Source => Boolean(source)).map(cloneSource);
    },
    async listSources(topicId = demoTopic.id) {
      return snapshot(topicId).sources.sort(sortByPublishedAtDesc);
    },
    async findEntityByAlias(value, topicId = demoTopic.id) {
      return findEntityInSnapshot(snapshot(topicId), value);
    },
    async getEntityPage(slug, topicId = demoTopic.id) {
      return buildEntityPage(snapshot(topicId), slug);
    },
    async getGraphData(topicId = demoTopic.id) {
      return buildGraphData(snapshot(topicId));
    },
    async getSavedQuery(slugOrId) {
      return savedQueries.find((query) => query.slug === slugOrId || query.id === slugOrId) ?? null;
    },
    async listSavedQueries(limit = 8) {
      return savedQueries.slice(0, limit).map(cloneSavedQuery);
    },
    async saveQuery(question, answerMd, citedSourceIds = [], topicId = demoTopic.id, graphContext = null) {
      const identity = savedQueryIdentity(question);
      const saved: SavedQuery = {
        id: identity.id,
        topicId,
        slug: identity.slug,
        question,
        answerMd,
        citedSourceIds,
        graphContext: graphContext ?? null,
        savedAt: now().toISOString(),
      };
      const existingIndex = savedQueries.findIndex((query) => query.id === saved.id);
      if (existingIndex >= 0) savedQueries[existingIndex] = saved;
      else savedQueries.unshift(saved);
      return cloneSavedQuery(saved);
    },
    async upsertSource(source) {
      const existingIndex = sources.findIndex((item) => item.id === source.id);
      const next = cloneSource(source);
      if (existingIndex >= 0) sources[existingIndex] = next;
      else sources.unshift(next);
      return cloneSource(next);
    },
    async updateSourceStatus(id, status) {
      const source = sources.find((item) => item.id === id);
      if (!source) return null;
      source.hydraStatus = status;
      return cloneSource(source);
    },
    async updateSourceWorkflowStatus(id, status) {
      const source = sources.find((item) => item.id === id);
      if (!source) return null;
      source.workflowStatus = status;
      return cloneSource(source);
    },
    async upsertEntityWithAliases(input) {
      const normalizedCanonical = normalizeAlias(input.entity.canonicalName);
      const existingIndex = entities.findIndex(
        (entity) => entity.id === input.entity.id || (entity.topicId === input.entity.topicId && normalizeAlias(entity.canonicalName) === normalizedCanonical)
      );
      const next = cloneEntity(input.entity);
      if (existingIndex >= 0) {
        const existing = entities[existingIndex];
        entities[existingIndex] = {
          ...existing,
          canonicalName: next.canonicalName,
          entityType: next.entityType,
          hydraEntityId: next.hydraEntityId ?? existing.hydraEntityId,
        };
      }
      else entities.push(next);
      const entity = entities[existingIndex >= 0 ? existingIndex : entities.length - 1];
      for (const alias of input.aliases ?? []) {
        const normalized = normalizeAlias(alias);
        if (!normalized) continue;
        if (!aliases.some((item) => item.entityId === entity.id && item.alias === normalized)) aliases.push({ entityId: entity.id, alias: normalized });
      }
      return cloneEntity(entity);
    },
    async insertClaims(nextClaims) {
      for (const claim of nextClaims) {
        const existingIndex = claims.findIndex((item) => item.id === claim.id);
        if (existingIndex >= 0) claims[existingIndex] = cloneClaim(claim);
        else claims.push(cloneClaim(claim));
      }
      return nextClaims.map(cloneClaim);
    },
    async insertClaimRelations(nextRelations) {
      for (const relation of nextRelations) {
        const existingIndex = relations.findIndex((item) => item.claimA === relation.claimA && item.claimB === relation.claimB);
        if (existingIndex >= 0) relations[existingIndex] = cloneRelation(relation);
        else relations.push(cloneRelation(relation));
      }
      return nextRelations.map(cloneRelation);
    },
    async upsertLede(lede) {
      const existingIndex = ledes.findIndex((item) => item.entityId === lede.entityId);
      const next = cloneLede(lede);
      if (existingIndex >= 0) ledes[existingIndex] = next;
      else ledes.push(next);
      return cloneLede(next);
    },
  };
}

export function createPostgresStore(databaseUrl = process.env.DATABASE_URL ?? "", sql: Sql = neon(databaseUrl) as unknown as Sql): ConsensusStore {
  async function ensureDemoTopic(topicId: string) {
    if (topicId === demoTopic.id) await store.upsertTopic(demoTopic);
  }

  async function loadSnapshot(topicId = demoTopic.id): Promise<StoreSnapshot> {
    const [topicRows, sourceRows, entityRows, aliasRows, claimRows, relationRows, ledeRows] = await Promise.all([
      sql`SELECT id, title, hydra_sub_tenant_id, created_at FROM topics WHERE id = ${topicId} LIMIT 1`,
      sql`SELECT id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id, body_excerpt FROM sources WHERE topic_id = ${topicId}`,
      sql`SELECT id, topic_id, canonical_name, entity_type, hydra_entity_id, first_seen FROM entities WHERE topic_id = ${topicId}`,
      sql`
        SELECT ea.alias, ea.entity_id
        FROM entity_aliases ea
        JOIN entities e ON e.id = ea.entity_id
        WHERE e.topic_id = ${topicId}
      `,
      sql`
        SELECT c.id, c.source_id, c.entity_id, c.claim_text, c.stance, c.confidence, c.chunk_uuid, c.evidence_quote, c.extracted_at
        FROM claims c
        JOIN entities e ON e.id = c.entity_id
        WHERE e.topic_id = ${topicId}
      `,
      sql`
        SELECT DISTINCT cr.claim_a, cr.claim_b, cr.relation, cr.rationale, cr.llm_confidence, cr.judged_at
        FROM claim_relations cr
        WHERE cr.claim_a IN (
          SELECT c.id
          FROM claims c
          JOIN entities e ON e.id = c.entity_id
          WHERE e.topic_id = ${topicId}
        )
        OR cr.claim_b IN (
          SELECT c.id
          FROM claims c
          JOIN entities e ON e.id = c.entity_id
          WHERE e.topic_id = ${topicId}
        )
      `,
      sql`
        SELECT l.entity_id, l.lede, l.source_count_at_gen, l.generated_at
        FROM ledes l
        JOIN entities e ON e.id = l.entity_id
        WHERE e.topic_id = ${topicId}
      `,
    ]);

    return {
      topic: topicRows[0] ? rowToTopic(topicRows[0]) : cloneTopic(demoTopic),
      sources: sourceRows.map(rowToSource),
      entities: entityRows.map(rowToEntity),
      aliases: aliasRows.map(rowToAlias),
      claims: claimRows.map(rowToClaim),
      relations: relationRows.map(rowToRelation),
      ledes: ledeRows.map(rowToLede),
    };
  }

  const store: ConsensusStore = {
    async upsertTopic(topic) {
      const rows = await sql`
        INSERT INTO topics (id, title, hydra_sub_tenant_id, created_at)
        VALUES (${topic.id}, ${topic.title}, ${topic.hydraSubTenantId}, ${topic.createdAt})
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          hydra_sub_tenant_id = EXCLUDED.hydra_sub_tenant_id
        RETURNING id, title, hydra_sub_tenant_id, created_at
      `;
      return rowToTopic(rows[0]);
    },
    async getDashboard(topicId = demoTopic.id) {
      return buildDashboard(await loadSnapshot(topicId));
    },
    async getSource(id) {
      const rows = await sql`
        SELECT id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id, body_excerpt
        FROM sources
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] ? rowToSource(rows[0]) : null;
    },
    async getSourcesByIds(ids) {
      const sources = await Promise.all(ids.map((id) => store.getSource(id)));
      return sources.filter((source): source is Source => Boolean(source));
    },
    async listSources(topicId = demoTopic.id) {
      return (await loadSnapshot(topicId)).sources.sort(sortByPublishedAtDesc);
    },
    async findEntityByAlias(value, topicId = demoTopic.id) {
      return findEntityInSnapshot(await loadSnapshot(topicId), value);
    },
    async getEntityPage(slug, topicId = demoTopic.id) {
      return buildEntityPage(await loadSnapshot(topicId), slug);
    },
    async getGraphData(topicId = demoTopic.id) {
      return buildGraphData(await loadSnapshot(topicId));
    },
    async getSavedQuery(slugOrId) {
      const rows = await sql`
        SELECT id, topic_id, slug, question, answer_md, cited_source_ids, graph_context, saved_at
        FROM saved_queries
        WHERE id = ${slugOrId} OR slug = ${slugOrId}
        LIMIT 1
      `;
      return rows[0] ? rowToSavedQuery(rows[0]) : null;
    },
    async listSavedQueries(limit = 8) {
      const rows = await sql`
        SELECT id, topic_id, slug, question, answer_md, cited_source_ids, graph_context, saved_at
        FROM saved_queries
        ORDER BY saved_at DESC
        LIMIT ${limit}
      `;
      return rows.map(rowToSavedQuery);
    },
    async saveQuery(question, answerMd, citedSourceIds = [], topicId = demoTopic.id, graphContext = null) {
      await ensureDemoTopic(topicId);
      const identity = savedQueryIdentity(question);
      const graphJson = graphContext ? JSON.stringify(graphContext) : null;
      const rows = await sql`
        INSERT INTO saved_queries (id, topic_id, slug, question, answer_md, cited_source_ids, graph_context, saved_at)
        VALUES (${identity.id}, ${topicId}, ${identity.slug}, ${question}, ${answerMd}, ${citedSourceIds}, ${graphJson}, ${new Date().toISOString()})
        ON CONFLICT (id) DO UPDATE SET
          question = EXCLUDED.question,
          slug = EXCLUDED.slug,
          answer_md = EXCLUDED.answer_md,
          cited_source_ids = EXCLUDED.cited_source_ids,
          graph_context = EXCLUDED.graph_context,
          saved_at = EXCLUDED.saved_at
        RETURNING id, topic_id, slug, question, answer_md, cited_source_ids, graph_context, saved_at
      `;
      return rowToSavedQuery(rows[0]);
    },
    async upsertSource(source) {
      await ensureDemoTopic(source.topicId);
      const rows = await sql`
        INSERT INTO sources (id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id, body_excerpt)
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
          ${source.workflowRunId},
          ${source.bodyExcerpt}
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
          workflow_run_id = EXCLUDED.workflow_run_id,
          body_excerpt = COALESCE(EXCLUDED.body_excerpt, sources.body_excerpt)
        RETURNING id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id, body_excerpt
      `;
      return rowToSource(rows[0]);
    },
    async updateSourceStatus(id, status) {
      const rows = await sql`
        UPDATE sources
        SET hydra_status = ${status}
        WHERE id = ${id}
        RETURNING id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id, body_excerpt
      `;
      return rows[0] ? rowToSource(rows[0]) : null;
    },
    async updateSourceWorkflowStatus(id, status) {
      const rows = await sql`
        UPDATE sources
        SET workflow_status = ${status}
        WHERE id = ${id}
        RETURNING id, topic_id, url, title, publisher, published_at, ingested_at, hydra_status, workflow_status, workflow_run_id, body_excerpt
      `;
      return rows[0] ? rowToSource(rows[0]) : null;
    },
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
    async insertClaims(claims) {
      const inserted: Claim[] = [];
      for (const claim of claims) {
        const rows = await sql`
          INSERT INTO claims (id, source_id, entity_id, claim_text, stance, confidence, chunk_uuid, evidence_quote, extracted_at)
          VALUES (
            ${claim.id},
            ${claim.sourceId},
            ${claim.entityId},
            ${claim.claimText},
            ${claim.stance},
            ${claim.confidence},
            ${claim.chunkUuid},
            ${claim.evidenceQuote},
            ${claim.extractedAt}
          )
          ON CONFLICT (id) DO UPDATE SET
            source_id = EXCLUDED.source_id,
            entity_id = EXCLUDED.entity_id,
            claim_text = EXCLUDED.claim_text,
            stance = EXCLUDED.stance,
            confidence = EXCLUDED.confidence,
            chunk_uuid = EXCLUDED.chunk_uuid,
            evidence_quote = COALESCE(EXCLUDED.evidence_quote, claims.evidence_quote),
            extracted_at = EXCLUDED.extracted_at
          RETURNING id, source_id, entity_id, claim_text, stance, confidence, chunk_uuid, evidence_quote, extracted_at
        `;
        inserted.push(rowToClaim(rows[0]));
      }
      return inserted;
    },
    async insertClaimRelations(relations) {
      const inserted: ClaimRelation[] = [];
      for (const relation of relations) {
        const rows = await sql`
          INSERT INTO claim_relations (claim_a, claim_b, relation, rationale, llm_confidence, judged_at)
          VALUES (
            ${relation.claimA},
            ${relation.claimB},
            ${relation.relation},
            ${relation.rationale},
            ${relation.llmConfidence},
            ${relation.judgedAt}
          )
          ON CONFLICT (claim_a, claim_b) DO UPDATE SET
            relation = EXCLUDED.relation,
            rationale = EXCLUDED.rationale,
            llm_confidence = EXCLUDED.llm_confidence,
            judged_at = EXCLUDED.judged_at
          RETURNING claim_a, claim_b, relation, rationale, llm_confidence, judged_at
        `;
        inserted.push(rowToRelation(rows[0]));
      }
      return inserted;
    },
    async upsertLede(lede) {
      const rows = await sql`
        INSERT INTO ledes (entity_id, lede, source_count_at_gen, generated_at)
        VALUES (${lede.entityId}, ${lede.lede}, ${lede.sourceCountAtGen}, ${lede.generatedAt})
        ON CONFLICT (entity_id) DO UPDATE SET
          lede = EXCLUDED.lede,
          source_count_at_gen = EXCLUDED.source_count_at_gen,
          generated_at = EXCLUDED.generated_at
        RETURNING entity_id, lede, source_count_at_gen, generated_at
      `;
      return rowToLede(rows[0]);
    },
  };

  return store;
}

export const store = createStore();

export function normalizeAlias(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
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
  const established = citedClaims.filter(
    (claim) =>
      !contestedIds.has(claim.id) &&
      ((sourceCounts.get(claim.claimText) ?? 0) >= 2 ||
        relations.some((relation) => relation.relation === "agree" && (relation.claimA === claim.id || relation.claimB === claim.id)))
  );
  const establishedIds = new Set(established.map((claim) => claim.id));
  const singleSource = citedClaims.filter((claim) => !contestedIds.has(claim.id) && !establishedIds.has(claim.id));
  return { established, contested, singleSource };
}

function buildDashboard(snapshot: StoreSnapshot): DashboardData {
  const contradictPairs = new Set<string>();
  for (const relation of snapshot.relations) {
    if (relation.relation !== "contradict") continue;
    contradictPairs.add([relation.claimA, relation.claimB].sort().join(":"));
  }
  const contradictions = contradictPairs.size;
  const entities = snapshot.entities.map((entity) => {
    const entityClaims = snapshot.claims.filter((claim) => claim.entityId === entity.id);
    const claimIds = new Set(entityClaims.map((claim) => claim.id));
    const contestedClaimIds = new Set<string>();
    for (const relation of snapshot.relations) {
      if (relation.relation !== "contradict") continue;
      if (claimIds.has(relation.claimA)) contestedClaimIds.add(relation.claimA);
      if (claimIds.has(relation.claimB)) contestedClaimIds.add(relation.claimB);
    }
    return {
      ...entity,
      claimCount: entityClaims.length,
      contestedCount: contestedClaimIds.size,
    };
  });

  return {
    topic: snapshot.topic,
    stats: {
      entities: snapshot.entities.length,
      claims: snapshot.claims.length,
      sources: snapshot.sources.length,
      contradictions,
    },
    entities,
    sources: [...snapshot.sources].sort(sortByPublishedAtDesc).slice(0, 6),
  };
}

function buildEntityPage(snapshot: StoreSnapshot, slug: string): EntityPage | null {
  const entity = findEntityInSnapshot(snapshot, slug);
  if (!entity) return null;
  const claims = snapshot.claims
    .filter((claim) => claim.entityId === entity.id)
    .map((claim) => ({ ...claim, source: snapshot.sources.find((source) => source.id === claim.sourceId)! }))
    .filter((claim): claim is CitedClaim => Boolean(claim.source));
  const claimIds = new Set(claims.map((claim) => claim.id));
  const relations = snapshot.relations.filter((relation) => claimIds.has(relation.claimA) || claimIds.has(relation.claimB));
  const sourceIds = new Set(claims.map((claim) => claim.sourceId));
  const sources = snapshot.sources.filter((source) => sourceIds.has(source.id)).sort(sortByPublishedAtDesc);
  return {
    topic: snapshot.topic,
    entity,
    aliases: snapshot.aliases.filter((alias) => alias.entityId === entity.id),
    lede: snapshot.ledes.find((lede) => lede.entityId === entity.id) ?? null,
    sources,
    claims,
    relations,
    groups: groupClaimsForEntity({ entity, claims: snapshot.claims, sources: snapshot.sources, relations: snapshot.relations }),
    timeline: sources,
  };
}

function buildGraphData(snapshot: StoreSnapshot): GraphData {
  const entityClaimCount = new Map<string, number>();
  const sourceClaimCount = new Map<string, number>();
  for (const claim of snapshot.claims) {
    entityClaimCount.set(claim.entityId, (entityClaimCount.get(claim.entityId) ?? 0) + 1);
    sourceClaimCount.set(claim.sourceId, (sourceClaimCount.get(claim.sourceId) ?? 0) + 1);
  }
  const entityNodes = snapshot.entities.map((entity) => ({
    id: entity.id,
    label: entity.canonicalName,
    type: entity.entityType,
    claimCount: entityClaimCount.get(entity.id) ?? 0,
  }));
  const sourceNodes = snapshot.sources
    .filter((source) => (sourceClaimCount.get(source.id) ?? 0) > 0)
    .map((source) => ({
      id: `source:${source.id}`,
      label: source.title,
      type: "SOURCE" as const,
      claimCount: sourceClaimCount.get(source.id) ?? 0,
    }));
  const citationPairs = new Set<string>();
  const citationEdges = snapshot.claims.flatMap((claim) => {
    const key = `${claim.sourceId}:${claim.entityId}`;
    if (citationPairs.has(key)) return [];
    citationPairs.add(key);
    return [{
      id: `mentions-${citationPairs.size}`,
      source: `source:${claim.sourceId}`,
      target: claim.entityId,
      relation: "mentions" as const,
      label: "mentions",
      rationale: "Source contains at least one extracted claim for this entity.",
    }];
  });
  const claimToEntity = new Map(snapshot.claims.map((claim) => [claim.id, claim.entityId]));
  const relationEdges = snapshot.relations
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
  return { topic: snapshot.topic, nodes: [...entityNodes, ...sourceNodes], edges: [...citationEdges, ...relationEdges] };
}

function findEntityInSnapshot(snapshot: StoreSnapshot, value: string) {
  const normalized = normalizeAlias(value);
  return (
    snapshot.entities.find((entity) => normalizeAlias(entity.id) === normalized || normalizeAlias(entity.canonicalName) === normalized) ??
    snapshot.entities.find((entity) => snapshot.aliases.some((alias) => alias.entityId === entity.id && normalizeAlias(alias.alias) === normalized)) ??
    null
  );
}

function sortByPublishedAtDesc(a: Source, b: Source) {
  return Date.parse(b.publishedAt ?? b.ingestedAt) - Date.parse(a.publishedAt ?? a.ingestedAt);
}

function savedQueryIdentity(question: string) {
  const id = randomUUID();
  const suffix = id.slice(0, 8);
  const base = slugify(question).slice(0, 55) || "query";
  return { id, slug: `${base}-${suffix}` };
}

function rowToTopic(row: Record<string, unknown>): Topic {
  return {
    id: String(row.id),
    title: String(row.title),
    hydraSubTenantId: String(row.hydra_sub_tenant_id),
    createdAt: toIsoString(row.created_at),
  };
}

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
    bodyExcerpt: nullableString(row.body_excerpt),
  };
}

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: String(row.id),
    topicId: String(row.topic_id),
    canonicalName: String(row.canonical_name),
    entityType: String(row.entity_type ?? "PRODUCT") as Entity["entityType"],
    hydraEntityId: nullableString(row.hydra_entity_id),
    firstSeen: toIsoString(row.first_seen),
  };
}

function rowToAlias(row: Record<string, unknown>): EntityAlias {
  return { alias: String(row.alias), entityId: String(row.entity_id) };
}

function rowToClaim(row: Record<string, unknown>): Claim {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    entityId: String(row.entity_id),
    claimText: String(row.claim_text),
    stance: String(row.stance) as Claim["stance"],
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    chunkUuid: nullableString(row.chunk_uuid),
    evidenceQuote: nullableString(row.evidence_quote),
    extractedAt: toIsoString(row.extracted_at),
  };
}

function rowToRelation(row: Record<string, unknown>): ClaimRelation {
  return {
    claimA: String(row.claim_a),
    claimB: String(row.claim_b),
    relation: String(row.relation) as ClaimRelation["relation"],
    rationale: nullableString(row.rationale),
    llmConfidence: row.llm_confidence === null || row.llm_confidence === undefined ? null : Number(row.llm_confidence),
    judgedAt: toIsoString(row.judged_at),
  };
}

function rowToLede(row: Record<string, unknown>): Lede {
  return {
    entityId: String(row.entity_id),
    lede: String(row.lede),
    sourceCountAtGen: Number(row.source_count_at_gen ?? 0),
    generatedAt: toIsoString(row.generated_at),
  };
}

function rowToSavedQuery(row: Record<string, unknown>): SavedQuery {
  return {
    id: String(row.id),
    topicId: String(row.topic_id),
    slug: String(row.slug ?? row.id),
    question: String(row.question),
    answerMd: String(row.answer_md),
    citedSourceIds: Array.isArray(row.cited_source_ids) ? row.cited_source_ids.map(String) : [],
    graphContext: parseGraphContext(row.graph_context),
    savedAt: toIsoString(row.saved_at),
  };
}

function parseGraphContext(value: unknown): QueryGraphContext | null {
  if (!value) return null;
  let parsed: QueryGraphContext | null = null;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as QueryGraphContext;
    } catch {
      return null;
    }
  } else if (typeof value === "object") {
    parsed = value as QueryGraphContext;
  }
  if (!parsed) return null;
  if (!parsed.source) {
    // Legacy rows: infer from predicate signature.
    const localPredicates = new Set(["mentions", "cites", "agree", "contradict", "qualify"]);
    const allLocal = parsed.triplets.every((t) => localPredicates.has(t.predicate));
    parsed = { ...parsed, source: allLocal ? "local" : "hydra" };
  }
  return parsed;
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function cloneTopic(topic: Topic): Topic {
  return { ...topic };
}

function cloneSource(source: Source): Source {
  return { ...source };
}

function cloneEntity(entity: Entity): Entity {
  return { ...entity };
}

function cloneAlias(alias: EntityAlias): EntityAlias {
  return { ...alias };
}

function cloneClaim(claim: Claim): Claim {
  return { ...claim };
}

function cloneRelation(relation: ClaimRelation): ClaimRelation {
  return { ...relation };
}

function cloneLede(lede: Lede): Lede {
  return { ...lede };
}

function cloneSavedQuery(query: SavedQuery): SavedQuery {
  return {
    ...query,
    citedSourceIds: [...query.citedSourceIds],
    graphContext: query.graphContext
      ? { triplets: query.graphContext.triplets.map((t) => ({ ...t })), source: query.graphContext.source }
      : null,
  };
}
