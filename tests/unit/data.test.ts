import { describe, expect, test } from "vitest";
import { findEntityByAlias, getEntityPage, groupClaimsForEntity, stableClaimId, stableSourceId } from "@/lib/app-service";
import { demoClaimRelations, demoClaims, demoEntities, demoSources, demoTopic } from "@/lib/demo-data";

describe("stable IDs", () => {
  test("source IDs are deterministic SHA-256 values scoped to topic and URL", () => {
    const id = stableSourceId("ai-industry", "https://example.com/gpt-5");
    expect(id).toBe(stableSourceId("ai-industry", " https://example.com/gpt-5 "));
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toBe(stableSourceId("other-topic", "https://example.com/gpt-5"));
  });

  test("claim IDs are deterministic SHA-256 values scoped to source and text", () => {
    const id = stableClaimId("source-1", "GPT-5 shipped in May 2026.");
    expect(id).toBe(stableClaimId("source-1", " GPT-5 shipped in May 2026. "));
    expect(id).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("entity aliases and claim grouping", () => {
  test("resolves GPT-5 aliases to canonical entity", () => {
    expect(findEntityByAlias("gpt5")?.id).toBe("gpt-5");
  });

  test("separates established, contested, and single-source claims", () => {
    const gpt5 = demoEntities.find((entity) => entity.id === "gpt-5")!;
    const groups = groupClaimsForEntity({ entity: gpt5, claims: demoClaims, sources: demoSources, relations: demoClaimRelations });
    expect(groups.established.length).toBeGreaterThan(0);
    expect(groups.contested.length).toBeGreaterThan(0);
    expect(groups.singleSource.length).toBeGreaterThan(0);
  });

  test("entity pages include grouped claims and citation sources", async () => {
    const page = await getEntityPage("gpt5");
    expect(page?.topic.id).toBe(demoTopic.id);
    expect(page?.entity.id).toBe("gpt-5");
    expect(page?.groups.contested.length).toBeGreaterThan(0);
  });
});
