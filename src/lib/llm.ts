import { z } from "zod";
import { synthesizeDemoAnswer } from "./app-service";

export const ExtractedClaimSchema = z.object({
  entity: z.string(),
  claim: z.string(),
  stance: z.enum(["factual", "opinion", "prediction", "leak", "rumor"]),
  confidence: z.number().min(0).max(1),
});

export const ClaimExtractionSchema = z.object({ claims: z.array(ExtractedClaimSchema) });
export const CanonicalEntitySchema = z.object({ raw: z.string(), canonicalName: z.string(), entityType: z.enum(["PERSON", "ORG", "PRODUCT", "EVENT", "MODEL"]) });
export const JudgementSchema = z.object({
  relation: z.enum(["agree", "contradict", "qualify", "unrelated"]),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

export async function complete(prompt: string) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) return fallbackCompletion(prompt);
  const response = await fetch(`${process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.NIM_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });
  if (!response.ok) throw new Error(`NIM request failed: ${response.status}`);
  const json = await response.json();
  return String(json.choices?.[0]?.message?.content ?? "");
}

export async function extractClaims(text: string) {
  if (!process.env.NIM_API_KEY) {
    return ClaimExtractionSchema.parse({
      claims: [
        { entity: "GPT-5", claim: text.includes("late") ? "GPT-5 will not be released until late 2026." : "OpenAI released GPT-5 as a generally available model in May 2026.", stance: text.includes("leak") ? "leak" : "factual", confidence: 0.82 },
      ],
    }).claims;
  }
  const raw = await complete(`Extract atomic claims as JSON {claims:[{entity,claim,stance,confidence}]}:\n${text.slice(0, 12000)}`);
  return ClaimExtractionSchema.parse(JSON.parse(raw)).claims;
}

export async function canonicalizeEntities(rawEntities: string[]) {
  return rawEntities.map((raw) =>
    CanonicalEntitySchema.parse({
      raw,
      canonicalName: raw.replace(/gpt\s?5/i, "GPT-5").replace(/open ai/i, "OpenAI"),
      entityType: /gpt|claude/i.test(raw) ? "MODEL" : /sam/i.test(raw) ? "PERSON" : "ORG",
    })
  );
}

export async function judgeContradictions(a: string, b: string) {
  if (!process.env.NIM_API_KEY) {
    const relation = /not|late|dispute|non-public/i.test(`${a} ${b}`) ? "contradict" : "agree";
    return JudgementSchema.parse({ relation, rationale: "Deterministic fallback compared release and benchmark language.", confidence: 0.75 });
  }
  const raw = await complete(`Judge relation agree|contradict|qualify|unrelated as JSON:\nA:${a}\nB:${b}`);
  return JudgementSchema.parse(JSON.parse(raw));
}

export async function synthesizeLede(entityName: string, claims: string[]) {
  return `${entityName} has ${claims.length} tracked claims. The page separates established, contested, and single-source material.`;
}

export async function synthesizeQueryAnswer(question: string) {
  return synthesizeDemoAnswer(question);
}

function fallbackCompletion(prompt: string) {
  if (/json/i.test(prompt)) return JSON.stringify({ claims: [] });
  return "Demo fallback response. Configure NIM_API_KEY for live synthesis.";
}
