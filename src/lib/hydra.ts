export interface HydraKnowledgeInput {
  id: string;
  subTenantId: string;
  source: string;
  title: string;
  url?: string | null;
  timestamp?: string | null;
  text: string;
  metadata?: Record<string, unknown>;
}

const baseUrl = () => process.env.HYDRA_BASE_URL ?? "https://api.hydradb.ai";

export async function uploadKnowledge(input: HydraKnowledgeInput) {
  if (!process.env.HYDRA_API_KEY) return { sourceId: input.id, status: "queued" as const, demo: true };
  const body = {
    tenant_id: process.env.HYDRA_TENANT_ID,
    sub_tenant_id: input.subTenantId,
    id: input.id,
    source: input.source,
    title: input.title,
    url: input.url,
    timestamp: input.timestamp,
    content: { text: input.text },
    additional_metadata: input.metadata,
  };
  const response = await fetch(`${baseUrl()}/ingestion/upload_knowledge`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HYDRA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ app_knowledge: body }),
  });
  if (!response.ok) throw new Error(`Hydra upload failed: ${response.status}`);
  return response.json();
}

export async function pollHydraStatus(sourceId: string) {
  if (!process.env.HYDRA_API_KEY) return { sourceId, status: "success" as const, demo: true };
  const response = await fetch(`${baseUrl()}/ingestion/status/${sourceId}`, {
    headers: { Authorization: `Bearer ${process.env.HYDRA_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Hydra status failed: ${response.status}`);
  return response.json();
}

export async function fullRecall(subTenantId: string, query: string) {
  if (!process.env.HYDRA_API_KEY) return { chunks: [], graph_context: { chunk_relations: { triplets: [] } }, demo: true };
  const response = await fetch(`${baseUrl()}/recall/full_recall`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HYDRA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: process.env.HYDRA_TENANT_ID,
      sub_tenant_id: subTenantId,
      query,
      mode: "thinking",
      graph_context: true,
      recency_bias: 0.6,
      alpha: 0.8,
    }),
  });
  if (!response.ok) throw new Error(`Hydra recall failed: ${response.status}`);
  return response.json();
}

export async function graphRecall(subTenantId: string) {
  return fullRecall(subTenantId, "topic-wide entity graph relations");
}
