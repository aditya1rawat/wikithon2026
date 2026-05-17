import { afterEach, describe, expect, test, vi } from "vitest";
import { ClaimExtractionSchema, JudgementSchema, canonicalizeEntities, complete, extractClaims, judgeContradictions, synthesizeQueryAnswer } from "@/lib/llm";

const originalEnv = process.env;

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

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

  test("fallback query synthesis returns citations shape", async () => {
    const answer = await synthesizeQueryAnswer("What released?");
    expect(answer.answerMd).toContain("GPT-5");
    expect(answer.citedSourceIds).toEqual([]);
  });

  test("retries extraction with a stricter JSON-only prompt after invalid JSON", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "test-key", NIM_BASE_URL: "https://nim.test" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "not json" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claims: [{ entity: "GPT-5", claim: "GPT-5 shipped in May 2026.", stance: "factual", confidence: 0.91 }],
                }),
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const claims = await extractClaims("OpenAI says GPT-5 shipped in May 2026.");

    expect(claims).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(JSON.stringify(retryBody.messages)).toContain("JSON only");
  });

  test("canonicalizes entities in one live batch call", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "test-key", NIM_BASE_URL: "https://nim.test" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [
                  { raw: "gpt5", canonicalName: "GPT-5", entityType: "MODEL" },
                  { raw: "Open AI", canonicalName: "OpenAI", entityType: "ORG" },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const entities = await canonicalizeEntities(["gpt5", "Open AI"]);

    expect(entities.map((entity) => entity.canonicalName)).toEqual(["GPT-5", "OpenAI"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.stringify(body.messages)).toContain("gpt5");
    expect(JSON.stringify(body.messages)).toContain("Open AI");
  });

  test("fallback canonical entity emits family aliases for MODEL", async () => {
    const entities = await canonicalizeEntities(["GPT-5.5 Instant"]);
    expect(entities[0].canonicalName).toBe("GPT-5.5 Instant");
    expect(entities[0].entityType).toBe("MODEL");
    expect(entities[0].aliases).toContain("gpt-5");
    expect(entities[0].aliases).toContain("gpt-5.5-instant");
  });

  test("canonicalizeEntities returns aliases from live NIM batch", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "test-key", NIM_BASE_URL: "https://nim.test" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [
                  { raw: "gpt-5.5", canonicalName: "GPT-5.5 Instant", entityType: "MODEL", aliases: ["GPT-5", "GPT 5.5 Instant"] },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const entities = await canonicalizeEntities(["gpt-5.5"]);
    expect(entities[0].aliases).toEqual(expect.arrayContaining(["GPT-5", "GPT 5.5 Instant"]));
  });

  test("retries transient NIM network failures", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "test-key", NIM_BASE_URL: "https://nim.test" };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Recovered" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(complete("hello")).resolves.toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
