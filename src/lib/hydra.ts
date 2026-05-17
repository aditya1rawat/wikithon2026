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

export interface HydraPollOptions {
  intervalMs?: number;
  ceilingMs?: number;
}

const WRITE_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_CEILING_MS = 90_000;
const NON_TERMINAL_STATUSES = new Set(["queued", "in_progress", "processing", "graph_creation"]);
const TERMINAL_STATUSES = new Set(["success", "complete", "completed", "errored", "error", "failed"]);

const baseUrl = () => (process.env.HYDRA_BASE_URL ?? "https://api.hydradb.com").replace(/\/$/, "");

export async function uploadKnowledge(input: HydraKnowledgeInput) {
  if (!process.env.HYDRA_API_KEY) return { sourceId: input.id, status: "queued" as const, demo: true };
  const body = new FormData();
  body.append("tenant_id", process.env.HYDRA_TENANT_ID ?? "");
  body.append("app_knowledge", JSON.stringify([{
    tenant_id: process.env.HYDRA_TENANT_ID,
    sub_tenant_id: input.subTenantId,
    id: input.id,
    source: input.source,
    title: input.title,
    url: input.url ?? null,
    timestamp: input.timestamp ?? null,
    content: { text: input.text },
    additional_metadata: input.metadata ?? {},
  }]));
  return retry(async () => {
    const response = await fetchWithTimeout(`${baseUrl()}/ingestion/upload_knowledge`, {
      timeoutMs: WRITE_TIMEOUT_MS,
      init: {
        method: "POST",
        headers: hydraHeaders(false),
        body,
      },
    });
    if (!response.ok) throw new HydraError(`Hydra upload failed: ${response.status}`, isRetryableStatus(response.status));
    return response.json();
  }, 2);
}

export async function pollHydraStatus(sourceId: string, options: HydraPollOptions = {}) {
  if (!process.env.HYDRA_API_KEY) return { sourceId, status: "success" as const, demo: true };
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const ceilingMs = options.ceilingMs ?? POLL_CEILING_MS;
  const startedAt = Date.now();
  let transientFailures = 0;
  let lastStatus: { sourceId?: string; status: string; [key: string]: unknown } | null = null;

  while (Date.now() - startedAt <= ceilingMs) {
    try {
      const status = await readHydraStatus(sourceId);
      lastStatus = status;
      if (TERMINAL_STATUSES.has(status.status) || !NON_TERMINAL_STATUSES.has(status.status)) return status;
      transientFailures = 0;
    } catch (error) {
      transientFailures += 1;
      if (transientFailures > 1) throw error;
    }
    await sleep(intervalMs);
  }

  if (lastStatus) return { ...lastStatus, timedOut: true };
  throw new Error(`Hydra status polling timed out after ${ceilingMs}ms for ${sourceId}`);
}

export async function fullRecall(subTenantId: string, query: string) {
  if (!process.env.HYDRA_API_KEY) return { chunks: [], graph_context: { chunk_relations: { triplets: [] } }, demo: true };
  const response = await fetchWithTimeout(`${baseUrl()}/recall/full_recall`, {
    timeoutMs: READ_TIMEOUT_MS,
    init: {
      method: "POST",
      headers: hydraHeaders(true),
      body: JSON.stringify({
        tenant_id: process.env.HYDRA_TENANT_ID,
        sub_tenant_id: subTenantId,
        query,
        mode: "thinking",
        graph_context: true,
        recency_bias: 0.6,
        alpha: 0.8,
      }),
    },
  });
  if (!response.ok) throw new Error(`Hydra recall failed: ${response.status}`);
  return response.json();
}

export async function recallEntityContext(subTenantId: string, canonicalName: string) {
  return fullRecall(subTenantId, `${canonicalName} recent claims context`);
}

export async function recallClaimContext(subTenantId: string, claimText: string) {
  return fullRecall(subTenantId, claimText);
}

export async function graphRecall(subTenantId: string) {
  return fullRecall(subTenantId, "topic-wide entity graph relations");
}

export async function recallGraphContext(subTenantId: string) {
  return graphRecall(subTenantId);
}

async function readHydraStatus(sourceId: string) {
  const url = `${baseUrl()}/ingestion/verify_processing?file_ids=${encodeURIComponent(sourceId)}&tenant_id=${encodeURIComponent(process.env.HYDRA_TENANT_ID ?? "")}`;
  const response = await fetchWithTimeout(url, {
    timeoutMs: READ_TIMEOUT_MS,
    init: { method: "POST", headers: hydraHeaders(false) },
  });
  if (!response.ok) throw new HydraError(`Hydra status failed: ${response.status}`, isRetryableStatus(response.status));
  const json = await response.json();
  const status = json.statuses?.[0]?.indexing_status ?? "errored";
  return { sourceId, status, raw: json };
}

function hydraHeaders(json: boolean) {
  return {
    Authorization: `Bearer ${process.env.HYDRA_API_KEY}`,
    accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function fetchWithTimeout(target: string, { init, timeoutMs }: { init: RequestInit; timeoutMs: number }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new HydraError(`Hydra request timed out after ${timeoutMs}ms`, true);
    throw new HydraError(error instanceof Error ? error.message : "Hydra request failed", true);
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

class HydraError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

async function retry<T>(operation: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof HydraError ? error.retryable : false;
      if (!retryable || attempt === attempts - 1) break;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
