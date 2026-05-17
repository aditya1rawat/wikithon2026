import { beforeAll, describe, expect, test, vi } from "vitest";
import { demoClaimRelations, demoClaims, demoEntities, demoSources, demoTopic } from "@/lib/demo-data";
import type * as AppService from "@/lib/app-service";

let appService: typeof AppService;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  appService = await import("@/lib/app-service");
});

describe("stable IDs", () => {
  test("source IDs are deterministic SHA-256 values scoped to topic and URL", () => {
    const id = appService.stableSourceId("ai-industry", "https://example.com/gpt-5");
    expect(id).toBe(appService.stableSourceId("ai-industry", " https://example.com/gpt-5 "));
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toBe(appService.stableSourceId("other-topic", "https://example.com/gpt-5"));
  });

  test("claim IDs are deterministic SHA-256 values scoped to source and text", () => {
    const id = appService.stableClaimId("source-1", "GPT-5 shipped in May 2026.");
    expect(id).toBe(appService.stableClaimId("source-1", " GPT-5 shipped in May 2026. "));
    expect(id).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("entity aliases and claim grouping", () => {
  test("resolves GPT-5 aliases to canonical entity", async () => {
    expect((await appService.findEntityByAlias("gpt5"))?.id).toBe("gpt-5");
  });

  test("separates established, contested, and single-source claims", () => {
    const gpt5 = demoEntities.find((entity) => entity.id === "gpt-5")!;
    const groups = appService.groupClaimsForEntity({ entity: gpt5, claims: demoClaims, sources: demoSources, relations: demoClaimRelations });
    expect(groups.established.length).toBeGreaterThan(0);
    expect(groups.contested.length).toBeGreaterThan(0);
    expect(groups.singleSource.length).toBeGreaterThan(0);
  });

  test("entity pages include grouped claims and citation sources", async () => {
    const page = await appService.getEntityPage("gpt5");
    expect(page?.topic.id).toBe(demoTopic.id);
    expect(page?.entity.id).toBe("gpt-5");
    expect(page?.groups.contested.length).toBeGreaterThan(0);
  });
});
