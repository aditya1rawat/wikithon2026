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
    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect(body.get("tenant_id")).toBe("tenant-1");
    expect(JSON.parse(String(body.get("app_knowledge")))).toEqual([
      {
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
    ]);
  });

  test("polls status until terminal success within the ceiling", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_TENANT_ID: "tenant-1",
      HYDRA_BASE_URL: "https://hydra.test",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ file_id: "s1", indexing_status: "queued" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ file_id: "s1", indexing_status: "processing" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ file_id: "s1", indexing_status: "completed" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollHydraStatus("s1", { intervalMs: 1, ceilingMs: 200 })).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hydra.test/ingestion/verify_processing?file_ids=s1&tenant_id=tenant-1");
  });

  test("returns unknown provider statuses as terminal for workflow mapping", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_TENANT_ID: "tenant-1",
      HYDRA_BASE_URL: "https://hydra.test",
    };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ file_id: "s1", indexing_status: "strange_done" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollHydraStatus("s1", { intervalMs: 1, ceilingMs: 200 })).resolves.toMatchObject({ status: "strange_done" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns last non-terminal status when polling reaches the ceiling", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_TENANT_ID: "tenant-1",
      HYDRA_BASE_URL: "https://hydra.test",
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ statuses: [{ file_id: "s1", indexing_status: "queued" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollHydraStatus("s1", { intervalMs: 1, ceilingMs: 5 })).resolves.toMatchObject({ status: "queued", timedOut: true });
    expect(fetchMock).toHaveBeenCalled();
  });
});
