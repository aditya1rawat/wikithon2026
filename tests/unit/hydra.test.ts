import { describe, expect, test } from "vitest";
import { fullRecall, pollHydraStatus, uploadKnowledge } from "@/lib/hydra";

describe("Hydra fallback", () => {
  test("upload returns queued demo result without env", async () => {
    const result = await uploadKnowledge({ id: "s1", subTenantId: "wikithon-ai-industry", source: "demo", title: "Demo", text: "body" });
    expect(result.status).toBe("queued");
  });

  test("status and recall return demo-safe shapes", async () => {
    await expect(pollHydraStatus("s1")).resolves.toMatchObject({ status: "success" });
    await expect(fullRecall("wikithon-ai-industry", "GPT-5")).resolves.toMatchObject({ graph_context: expect.any(Object) });
  });
});
