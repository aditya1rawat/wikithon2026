import { afterEach, describe, expect, test, vi } from "vitest";
import { getSource } from "@/lib/app-service";
import { runIngestWorkflow } from "@/lib/ingest-workflow";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const originalEnv = process.env;

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("ingest workflow", () => {
  test("runs the mocked no-key pipeline and invalidates touched cache tags", async () => {
    process.env = {
      ...originalEnv,
      NIM_API_KEY: "",
      HYDRA_API_KEY: "",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `
          <html>
            <head>
              <title>GPT-5 leak coverage</title>
              <meta property="og:site_name" content="Example News" />
              <meta property="article:published_time" content="2026-05-16T12:00:00.000Z" />
            </head>
            <body>
              <article>
                <h1>GPT-5 leak coverage</h1>
                <p>A leak says GPT-5 is late and will not be released until late 2026.</p>
              </article>
            </body>
          </html>
        `,
      })
    );
    const cache = await import("next/cache");

    const result = await runIngestWorkflow("https://example.com/gpt-5-late");

    expect(result.source.url).toBe("https://example.com/gpt-5-late");
    expect(result.hydraStatus!.status).toBe("success");
    expect(result.claims[0]).toMatchObject({ entity: "GPT-5", stance: "leak" });
    expect(result.touchedEntityIds).toContain("gpt-5");
    expect(cache.revalidateTag).toHaveBeenCalledWith("entity:gpt-5", "max");
    expect(cache.revalidateTag).toHaveBeenCalledWith("topic:ai-industry", "max");
    expect(cache.revalidateTag).toHaveBeenCalledWith("graph:ai-industry", "max");
  });

  test("calls revalidateTag with tag and profile arguments", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "", HYDRA_API_KEY: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html><head><title>t</title></head><body><article><p>GPT-5 shipped in May 2026.</p></article></body></html>",
      })
    );
    const cache = await import("next/cache");
    vi.mocked(cache.revalidateTag).mockClear();

    await runIngestWorkflow("https://example.com/tagcheck");

    const call = vi.mocked(cache.revalidateTag).mock.calls.find(
      (args) => args[0] === "topic:ai-industry"
    );
    expect(call).toBeDefined();
    expect(call![1]).toBe("max");
  });

  test("hydra timeout does not block local workflow_status = complete", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_TENANT_ID: "tenant-1",
      HYDRA_BASE_URL: "https://hydra.test",
      NIM_API_KEY: "",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `<html><head><title>x</title></head><body><article><p>OpenAI released GPT-5 as a generally available model in May 2026.</p></article></body></html>`,
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s3", status: "queued" }) })
        .mockResolvedValue({ ok: true, json: async () => ({ statuses: [{ file_id: "s3", indexing_status: "queued" }] }) })
    );

    const result = await runIngestWorkflow("https://example.com/hydra-stuck");
    const source = await getSource(result.source.id);

    expect(source?.hydraStatus).toBe("queued");
    expect(source?.workflowStatus).toBe("complete");
  }, 20_000);

  test("workflow writes a lede for every touched entity", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "", HYDRA_API_KEY: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><title>t</title></head><body><article><p>OpenAI released GPT-5 as a generally available model in May 2026.</p></article></body></html>`,
      })
    );

    const result = await runIngestWorkflow("https://example.com/lede-check");
    const { getEntityPage } = await import("@/lib/app-service");

    for (const entityId of result.touchedEntityIds) {
      const page = await getEntityPage(entityId);
      expect(page?.lede?.lede).toBeTruthy();
    }
  });

  test("maps completed Hydra provider status to local success", async () => {
    process.env = {
      ...originalEnv,
      HYDRA_API_KEY: "test-key",
      HYDRA_TENANT_ID: "tenant-1",
      HYDRA_BASE_URL: "https://hydra.test",
      NIM_API_KEY: "",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `
            <html>
              <head><title>GPT-5 live coverage</title></head>
              <body><article><p>OpenAI released GPT-5 as a generally available model in May 2026.</p></article></body>
            </html>
          `,
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sourceId: "s2", status: "queued" }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ statuses: [{ file_id: "s2", indexing_status: "completed" }] }) })
    );

    const result = await runIngestWorkflow("https://example.com/gpt-5-completed");
    const source = await getSource(result.source.id);

    expect(result.hydraStatus).toMatchObject({ status: "completed" });
    expect(source?.hydraStatus).toBe("success");
  });
});
