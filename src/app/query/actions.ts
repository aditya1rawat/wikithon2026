"use server";

import { listSources, saveQuery } from "@/lib/app-service";
import { synthesizeQueryAnswer } from "@/lib/llm";
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
  const answer = await synthesizeQueryAnswer(question, candidates);
  const saved = await saveQuery(question, answer.answerMd, answer.citedSourceIds);
  redirect(`/wiki/q/${saved.slug}`);
}
