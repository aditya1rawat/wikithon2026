"use server";

import { saveQuery, synthesizeDemoAnswer } from "@/lib/app-service";
import { redirect } from "next/navigation";

export async function askQuestion(formData: FormData) {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/query");
  const answer = await synthesizeDemoAnswer(question);
  const saved = await saveQuery(question, answer);
  redirect(`/wiki/q/${saved.slug}`);
}
