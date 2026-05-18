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
      if (!bySource[sourceId]) bySource[sourceId] = content;
    }
    return bySource;
  } catch (error) {
    console.warn(`[recall] failed for entity ${canonicalName}:`, error);
    return {};
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
  return { triplets };
}
