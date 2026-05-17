import { z } from "zod";
import { synthesizeDemoAnswer } from "./app-service";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_SOURCE_CHARS = 48_000;

export const ExtractedClaimSchema = z.object({
  entity: z.string(),
  claim: z.string(),
  stance: z.enum(["factual", "opinion", "prediction", "leak", "rumor"]),
  confidence: z.number().min(0).max(1),
});

export const ClaimExtractionSchema = z.object({ claims: z.array(ExtractedClaimSchema) });
export const CanonicalEntitySchema = z.object({ raw: z.string(), canonicalName: z.string(), entityType: z.enum(["PERSON", "ORG", "PRODUCT", "EVENT", "MODEL"]) });
export const CanonicalEntityBatchSchema = z.object({ entities: z.array(CanonicalEntitySchema) });
export const JudgementSchema = z.object({
  relation: z.enum(["agree", "contradict", "qualify", "unrelated"]),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});
export const LedeSchema = z.object({ lede: z.string().min(1) });
export const QueryAnswerSchema = z.object({ answerMd: z.string().min(1), citedSourceIds: z.array(z.string()).default([]) });

interface CompleteOptions {
  system?: string;
  timeoutMs?: number;
  jsonOnly?: boolean;
  attempts?: number;
}

export async function complete(prompt: string, options: CompleteOptions = {}) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) return fallbackCompletion(prompt);
  return retry(async () => {
    const response = await fetchWithTimeout(`${nimBaseUrl()}/chat/completions`, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.NIM_MODEL ?? "meta/llama-3.1-8b-instruct",
          messages: [
            { role: "system", content: options.system ?? "You are a precise ConsensusWiki extraction assistant." },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          ...(options.jsonOnly ? { response_format: { type: "json_object" } } : {}),
        }),
      },
    });
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      throw new ProviderError(`NIM request failed: ${response.status}`, retryable);
    }
    const json = await response.json();
    return String(json.choices?.[0]?.message?.content ?? "");
  }, options.attempts ?? 3);
}

export async function extractClaims(text: string) {
  if (!process.env.NIM_API_KEY) {
    return ClaimExtractionSchema.parse({
      claims: [
        { entity: "GPT-5", claim: text.includes("late") ? "GPT-5 will not be released until late 2026." : "OpenAI released GPT-5 as a generally available model in May 2026.", stance: text.includes("leak") ? "leak" : "factual", confidence: 0.82 },
      ],
    }).claims;
  }
  const prompt = `Extract atomic claims from this source.

Return JSON matching exactly:
{"claims":[{"entity":"string","claim":"string","stance":"factual|opinion|prediction|leak|rumor","confidence":0.0}]}

Rules:
- Claims must be atomic and cite one entity.
- Use concise claim text that preserves dates, numbers, and qualifiers.
- Confidence is 0 to 1.

Source:
${truncateForPrompt(text)}`;
  const retryPrompt = `${prompt}

The previous response was invalid. JSON only. No markdown, prose, comments, or trailing commas.`;
  try {
    const result = await completeJson(prompt, ClaimExtractionSchema, retryPrompt);
    return result.claims.length ? result.claims : fallbackExtractClaims(text);
  } catch {
    return fallbackExtractClaims(text);
  }
}

export async function canonicalizeEntities(rawEntities: string[]) {
  const unique = [...new Set(rawEntities.map((raw) => raw.trim()).filter(Boolean))];
  if (!process.env.NIM_API_KEY) return unique.map(fallbackCanonicalEntity);
  const prompt = `Canonicalize these entity mentions as one batch.

Return JSON matching exactly:
{"entities":[{"raw":"original string","canonicalName":"canonical display name","entityType":"PERSON|ORG|PRODUCT|EVENT|MODEL"}]}

Preserve one output object for each input mention.

Entities:
${JSON.stringify(unique)}`;
  const retryPrompt = `${prompt}

The previous response was invalid. JSON only. Return only the object with an entities array.`;
  try {
    return (await completeJson(prompt, CanonicalEntityBatchSchema, retryPrompt)).entities;
  } catch {
    return unique.map(fallbackCanonicalEntity);
  }
}

export async function judgeContradictions(a: string, b: string) {
  if (!process.env.NIM_API_KEY) {
    const relation = /not|late|dispute|non-public/i.test(`${a} ${b}`) ? "contradict" : "agree";
    return JudgementSchema.parse({ relation, rationale: "Deterministic fallback compared release and benchmark language.", confidence: 0.75 });
  }
  const prompt = `Judge the relation between two ConsensusWiki claims.

Return JSON matching exactly:
{"relation":"agree|contradict|qualify|unrelated","rationale":"short reason","confidence":0.0}

Claim A: ${a}
Claim B: ${b}`;
  const retryPrompt = `${prompt}

The previous response was invalid. JSON only. No markdown or extra text.`;
  try {
    return await completeJson(prompt, JudgementSchema, retryPrompt);
  } catch {
    return fallbackJudgement(a, b);
  }
}

export async function synthesizeLede(entityName: string, claims: string[]) {
  if (process.env.NIM_API_KEY) {
    const prompt = `Write a compact ConsensusWiki lede for an entity page.

Return JSON matching exactly:
{"lede":"one paragraph that separates established, contested, and single-source material when relevant"}

Entity: ${entityName}
Claims:
${JSON.stringify(claims.slice(0, 30))}`;
    const result = await completeJson(prompt, LedeSchema, `${prompt}\n\nThe previous response was invalid. JSON only.`);
    return result.lede;
  }
  return `${entityName} has ${claims.length} tracked claims. The page separates established, contested, and single-source material.`;
}

export async function synthesizeQueryAnswer(question: string) {
  if (process.env.NIM_API_KEY) {
    const prompt = `Answer an ad-hoc ConsensusWiki query with inline citation placeholders when available.

Return JSON matching exactly:
{"answerMd":"markdown answer","citedSourceIds":["source ids if known"]}

Question: ${question}`;
    const result = await completeJson(prompt, QueryAnswerSchema, `${prompt}\n\nThe previous response was invalid. JSON only.`);
    return result;
  }
  return QueryAnswerSchema.parse({ answerMd: await synthesizeDemoAnswer(question), citedSourceIds: [] });
}

function fallbackCompletion(prompt: string) {
  if (/json/i.test(prompt)) return JSON.stringify({ claims: [] });
  return "Demo fallback response. Configure NIM_API_KEY for live synthesis.";
}

function fallbackExtractClaims(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40 && sentence.length < 260)
    .slice(0, 5);
  const claims = sentences.map((sentence) => ({
    entity: inferEntity(sentence),
    claim: sentence,
    stance: "factual" as const,
    confidence: 0.62,
  }));
  return ClaimExtractionSchema.parse({ claims }).claims;
}

function inferEntity(sentence: string) {
  const model = sentence.match(/\bGPT-\d(?:\.\d+)?(?:\s+[A-Z][a-z]+)?\b/)?.[0];
  if (model) return model;
  if (/OpenAI/i.test(sentence)) return "OpenAI";
  return sentence.match(/\b[A-Z][A-Za-z0-9.-]+(?:\s+[A-Z][A-Za-z0-9.-]+){0,2}\b/)?.[0] ?? "Unknown";
}

function fallbackCanonicalEntity(raw: string) {
  return CanonicalEntitySchema.parse({
    raw,
    canonicalName: raw.replace(/gpt\s?5/i, "GPT-5").replace(/open ai/i, "OpenAI"),
    entityType: /gpt|claude/i.test(raw) ? "MODEL" : /sam/i.test(raw) ? "PERSON" : "ORG",
  });
}

function fallbackJudgement(a: string, b: string) {
  const relation = /not|late|dispute|non-public|contradict/i.test(`${a} ${b}`) ? "contradict" : "unrelated";
  return JudgementSchema.parse({ relation, rationale: "Deterministic fallback used because the judgement provider was unavailable.", confidence: 0.5 });
}

async function completeJson<T>(prompt: string, schema: z.ZodType<T>, retryPrompt: string): Promise<T> {
  const first = await complete(prompt, { system: jsonSystemPrompt(), jsonOnly: true, attempts: 1 });
  try {
    return schema.parse(parseModelJson(first));
  } catch {
    const second = await complete(retryPrompt, { system: strictJsonSystemPrompt(), jsonOnly: true, attempts: 1 });
    return schema.parse(parseModelJson(second));
  }
}

function parseModelJson(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(trimmed);
}

function truncateForPrompt(text: string, maxChars = MAX_SOURCE_CHARS) {
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 80) / 2);
  return `${text.slice(0, half)}\n\n[...source truncated...]\n\n${text.slice(-half)}`;
}

function nimBaseUrl() {
  return (process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
}

function jsonSystemPrompt() {
  return "You extract structured ConsensusWiki data. Return valid JSON that matches the requested schema.";
}

function strictJsonSystemPrompt() {
  return "JSON only. Return exactly one valid JSON object. Do not include markdown fences, commentary, explanations, or trailing commas.";
}

async function fetchWithTimeout(target: URL | string, { init, timeoutMs }: { init: RequestInit; timeoutMs: number }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(target.toString(), { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ProviderError("NIM request timed out", true);
    throw new ProviderError(error instanceof Error ? error.message : "NIM request failed", true);
  } finally {
    clearTimeout(timer);
  }
}

class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

async function retry<T>(operation: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError ? error.retryable : false;
      if (!retryable || attempt === attempts - 1) break;
      await sleep(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
