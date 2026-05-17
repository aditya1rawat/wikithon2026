"use server";

import { runIngestWorkflow } from "@/lib/ingest-workflow";
import { redirect } from "next/navigation";

export async function ingestSource(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (url) await runIngestWorkflow(url);
  redirect("/ingest");
}
