"use server";

import { registerDemoIngest } from "@/lib/app-service";
import { redirect } from "next/navigation";

export async function ingestSource(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (url) await registerDemoIngest(url);
  redirect("/ingest");
}
