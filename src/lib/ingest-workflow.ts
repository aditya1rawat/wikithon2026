import { revalidatePath } from "next/cache";
import { registerDemoIngest } from "./app-service";
import { demoTopic } from "./demo-data";
import { uploadKnowledge, pollHydraStatus } from "./hydra";
import { extractClaims, judgeContradictions } from "./llm";
import { normalizeUrl } from "./normalize-source";

export async function runIngestWorkflow(url: string) {
  const source = await registerDemoIngest(url);
  let normalized;
  try {
    normalized = await normalizeUrl(url);
  } catch {
    normalized = { title: source.title, publisher: source.publisher, publishedAt: source.publishedAt, bodyText: source.title };
  }
  await uploadKnowledge({
    id: source.id,
    subTenantId: demoTopic.hydraSubTenantId,
    source: normalized.publisher ?? "unknown",
    title: normalized.title,
    url,
    timestamp: normalized.publishedAt,
    text: normalized.bodyText,
    metadata: { topic_id: demoTopic.id, ingest_run_id: source.workflowRunId },
  });
  await pollHydraStatus(source.id);
  const claims = await extractClaims(normalized.bodyText);
  if (claims.length >= 2) await judgeContradictions(claims[0].claim, claims[1].claim);
  revalidatePath("/");
  revalidatePath("/graph");
  return { source, claims };
}
