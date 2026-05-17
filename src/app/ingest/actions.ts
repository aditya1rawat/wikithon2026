"use server";

import { getSource, registerDemoIngest, updateSourceWorkflowStatus } from "@/lib/app-service";
import { runIngestWorkflow } from "@/lib/ingest-workflow";
import { redirect } from "next/navigation";
import { after } from "next/server";

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
