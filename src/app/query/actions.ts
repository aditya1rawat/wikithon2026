"use server";

import { listSources, saveQuery } from "@/lib/app-service";
import { fullRecall } from "@/lib/hydra";
import { synthesizeQueryAnswer } from "@/lib/llm";
import { demoTopic } from "@/lib/demo-data";
import { buildLocalGraphContext, extractQueryGraphContext } from "@/lib/recall";
import { redirect } from "next/navigation";

export async function askQuestion(formData: FormData) {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/query");
  const sources = await listSources();
  const candidates = sources.slice(0, 20).map((source) => ({
    id: source.id,
    title: source.title,
    publisher: source.publisher,
  }));
  let graphContext = null;
  try {
    const recall = await fullRecall(demoTopic.hydraSubTenantId, question);
    graphContext = extractQueryGraphContext(recall);
  } catch (error) {
    console.warn("[query] hydra recall failed:", error);
  }
  const answer = await synthesizeQueryAnswer(question, candidates);
  // Fallback to local Postgres graph if Hydra returned no triplets.
  if (!graphContext && answer.citedSourceIds.length > 0) {
    try {
      graphContext = await buildLocalGraphContext(answer.citedSourceIds);
    } catch (error) {
      console.warn("[query] local graph fallback failed:", error);
    }
  }
  const saved = await saveQuery(question, answer.answerMd, answer.citedSourceIds, graphContext);
  redirect(`/wiki/q/${saved.slug}`);
}
