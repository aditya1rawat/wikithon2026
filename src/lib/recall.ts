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
