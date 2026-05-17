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
