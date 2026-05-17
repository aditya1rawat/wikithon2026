"use server";

import { saveQuery } from "@/lib/app-service";
import { synthesizeQueryAnswer } from "@/lib/llm";
import { redirect } from "next/navigation";

export async function askQuestion(formData: FormData) {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/query");
  const answer = await synthesizeQueryAnswer(question);
  const saved = await saveQuery(question, answer.answerMd, answer.citedSourceIds);
  redirect(`/wiki/q/${saved.slug}`);
}
