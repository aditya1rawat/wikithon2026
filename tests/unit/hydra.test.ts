import { afterEach, describe, expect, test, vi } from "vitest";
import { fullRecall, pollHydraStatus, uploadKnowledge } from "@/lib/hydra";

const originalEnv = process.env;

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("Hydra fallback", () => {
  test("upload returns queued demo result without env", async () => {
    const result = await uploadKnowledge({ id: "s1", subTenantId: "wikithon-ai-industry", source: "demo", title: "Demo", text: "body" });
    expect(result.status).toBe("queued");
  });

  test("status and recall return demo-safe shapes", async () => {
    await expect(pollHydraStatus("s1")).resolves.toMatchObject({ status: "success" });
    await expect(fullRecall("wikithon-ai-industry", "GPT-5")).resolves.toMatchObject({ graph_context: expect.any(Object) });
  });

  test("upload sends spec payload and retries one transient failure", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_TENANT_ID: "tenant-1",
      HYDRA_BASE_URL: "https://hydra.test",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "busy" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s1", status: "queued" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadKnowledge({
      id: "s1",
      subTenantId: "topic-subtenant",
      source: "publisher",
      title: "Title",
      url: "https://example.com/a",
      timestamp: "2026-05-16T00:00:00.000Z",
      text: "Article body",
      metadata: { topic_id: "ai-industry", ingest_run_id: "run-1" },
    });

    expect(result).toMatchObject({ status: "queued" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://hydra.test/ingestion/upload_knowledge");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      app_knowledge: {
        tenant_id: "tenant-1",
        sub_tenant_id: "topic-subtenant",
        id: "s1",
        source: "publisher",
        title: "Title",
        url: "https://example.com/a",
        timestamp: "2026-05-16T00:00:00.000Z",
        content: { text: "Article body" },
        additional_metadata: { topic_id: "ai-industry", ingest_run_id: "run-1" },
      },
    });
  });

  test("polls status until terminal success within the ceiling", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_BASE_URL: "https://hydra.test",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s1", status: "queued" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s1", status: "in_progress" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s1", status: "success" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollHydraStatus("s1", { intervalMs: 1, ceilingMs: 200 })).resolves.toMatchObject({ status: "success" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
