import { describe, expect, test } from "vitest";
import { ClaimExtractionSchema, JudgementSchema, canonicalizeEntities, extractClaims, judgeContradictions } from "@/lib/llm";

describe("LLM schemas and fallback", () => {
  test("validates extracted claim shape", () => {
    expect(ClaimExtractionSchema.parse({ claims: [{ entity: "GPT-5", claim: "GPT-5 shipped.", stance: "factual", confidence: 0.9 }] }).claims).toHaveLength(1);
  });

  test("fallback extraction returns structured claims", async () => {
    const claims = await extractClaims("leak says GPT-5 is late");
    expect(claims[0].entity).toBe("GPT-5");
  });

  test("canonicalizes common model spellings", async () => {
    const entities = await canonicalizeEntities(["gpt5"]);
    expect(entities[0].canonicalName).toBe("GPT-5");
  });

  test("fallback judgement uses schema", async () => {
    const judgement = await judgeContradictions("released in May", "not released until late 2026");
    expect(JudgementSchema.parse(judgement).relation).toBe("contradict");
  });
});
