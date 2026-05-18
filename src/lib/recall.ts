import { demoTopic } from "./demo-data";
import { recallEntityContext } from "./hydra";

interface ChunkLike {
  source_id?: string;
  chunk_content?: string;
}

export type ChunksBySource = Record<string, string>;

export async function getChunksForEntity(
  canonicalName: string,
  subTenantId: string = demoTopic.hydraSubTenantId,
): Promise<ChunksBySource> {
  try {
    const result = (await recallEntityContext(subTenantId, canonicalName)) as { chunks?: ChunkLike[] };
    const chunks = result?.chunks ?? [];
    const bySource: ChunksBySource = {};
    for (const chunk of chunks) {
      const sourceId = chunk?.source_id;
      const content = chunk?.chunk_content?.trim();
      if (!sourceId || !content) continue;
      const cleaned = cleanChunkContent(content);
      if (!cleaned) continue;
      if (!bySource[sourceId]) bySource[sourceId] = cleaned;
    }
    return bySource;
  } catch (error) {
    console.warn(`[recall] failed for entity ${canonicalName}:`, error);
    return {};
  }
}

/**
 * Hydra sometimes returns chunks that are the raw JSON envelope we originally
 * uploaded (legacy multipart bug indexed the stringified app_knowledge payload
 * as content). Detect those and either extract the underlying article text or
 * skip the chunk entirely.
 */
function cleanChunkContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const nestedText =
      (typeof parsed.content === "object" && parsed.content !== null
        ? (parsed.content as Record<string, unknown>).text
        : undefined) ?? parsed.text;
    if (typeof nestedText === "string" && nestedText.trim().length > 0) {
      return nestedText.trim();
    }
    return null;
  } catch {
    return trimmed;
  }
}

export function excerptFor(content: string, maxChars = 320) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

interface HydraEntity {
  name?: string;
  type?: string;
  entity_id?: string;
}

interface HydraRelation {
  canonical_predicate?: string;
  raw_predicate?: string;
  context?: string | null;
}

interface HydraTriplet {
  source?: HydraEntity;
  relation?: HydraRelation;
  target?: HydraEntity;
}

interface HydraScoredPath {
  triplets?: HydraTriplet[];
}

interface HydraRecallShape {
  graph_context?: {
    query_paths?: HydraScoredPath[];
    chunk_relations?: HydraScoredPath[];
  };
}

export async function buildLocalGraphContext(citedSourceIds: string[]): Promise<import("./types").QueryGraphContext | null> {
  if (citedSourceIds.length === 0) return null;
  const { store } = await import("./store");
  const dashboard = await store.getDashboard();
  const idToEntity = new Map(dashboard.entities.map((e) => [e.id, e]));
  // Pull each cited source's full page graph via existing getEntityPage doesn't fit;
  // load topic-wide graph and intersect with cited sources.
  const graph = await store.getGraphData();
  const citedSourceSet = new Set(citedSourceIds.map((id) => `source:${id}`));
  const triplets: import("./types").QueryTriplet[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.relation === "mentions" || edge.relation === "cites") {
      // Only keep mention edges where the source is in cited list (links source -> entity).
      if (!citedSourceSet.has(edge.source)) continue;
    }
    const srcLabel = graph.nodes.find((n) => n.id === edge.source)?.label;
    const tgtLabel = graph.nodes.find((n) => n.id === edge.target)?.label;
    if (!srcLabel || !tgtLabel) continue;
    const key = `${srcLabel}|${edge.relation}|${tgtLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const srcEntity = idToEntity.get(edge.source);
    const tgtEntity = idToEntity.get(edge.target);
    triplets.push({
      source: { name: srcLabel, type: srcEntity?.entityType ?? (edge.source.startsWith("source:") ? "SOURCE" : undefined) },
      target: { name: tgtLabel, type: tgtEntity?.entityType },
      predicate: edge.relation,
      context: edge.rationale ?? null,
      hops: edge.relation === "mentions" ? 1 : 2,
    });
  }
  if (triplets.length === 0) return null;
  return { triplets, source: "local" };
}

export function extractQueryGraphContext(recall: unknown): import("./types").QueryGraphContext | null {
  const r = recall as HydraRecallShape | null;
  if (!r?.graph_context) return null;
  const paths = [
    ...(r.graph_context.query_paths ?? []),
    ...(r.graph_context.chunk_relations ?? []),
  ];
  const triplets: import("./types").QueryTriplet[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const ts = path?.triplets ?? [];
    ts.forEach((t, idx) => {
      const srcName = t?.source?.name?.trim();
      const tgtName = t?.target?.name?.trim();
      const predicate = t?.relation?.canonical_predicate?.trim() || t?.relation?.raw_predicate?.trim() || "related_to";
      if (!srcName || !tgtName) return;
      const key = `${srcName}|${predicate}|${tgtName}`;
      if (seen.has(key)) return;
      seen.add(key);
      triplets.push({
        source: { name: srcName, type: t.source?.type, entityId: t.source?.entity_id },
        target: { name: tgtName, type: t.target?.type, entityId: t.target?.entity_id },
        predicate,
        context: t.relation?.context ?? null,
        hops: idx === 0 ? 1 : 2,
      });
    });
  }
  if (triplets.length === 0) return null;
  return { triplets, source: "hydra" };
}
