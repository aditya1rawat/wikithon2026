"use server";

import { getSource, registerDemoIngest, updateSourceStatus, updateSourceWorkflowStatus } from "@/lib/app-service";
import { mapProviderStatusToHydraStatus, runIngestWorkflow } from "@/lib/ingest-workflow";
import { pollHydraStatus } from "@/lib/hydra";
import { redirect } from "next/navigation";
import { after } from "next/server";

export async function recheckHydra(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  if (sourceId) {
    try {
      const status = await pollHydraStatus(sourceId, { ceilingMs: 5_000, intervalMs: 500 });
      await updateSourceStatus(sourceId, mapProviderStatusToHydraStatus(status.status));
    } catch (error) {
      console.warn(`[recheck] Hydra poll failed for ${sourceId}:`, error);
    }
  }
  redirect("/ingest");
}

export async function retryIngest(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  if (sourceId) {
    const source = await getSource(sourceId);
    if (source?.url) {
      await updateSourceWorkflowStatus(sourceId, "pending");
      await updateSourceStatus(sourceId, "queued");
      await after(async () => {
        try {
          await runIngestWorkflow(source.url!);
        } catch {
          const latest = await getSource(sourceId);
          if (!latest || latest.workflowStatus === "pending" || latest.workflowStatus === "extracting") {
            await updateSourceWorkflowStatus(sourceId, "failed_fetch");
          }
        }
      });
    }
  }
  redirect("/ingest");
}

export async function ingestSource(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (url) {
    const source = await registerDemoIngest(url);
    after(async () => {
      try {
        await runIngestWorkflow(url);
      } catch {
        const latest = await getSource(source.id);
        if (!latest || latest.workflowStatus === "pending" || latest.workflowStatus === "extracting") {
          await updateSourceWorkflowStatus(source.id, "failed_fetch");
        }
      }
    });
  }
  redirect("/ingest");
}
