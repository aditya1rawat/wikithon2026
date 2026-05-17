import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => callback(),
}));

const originalEnv = process.env;

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("retryIngest", () => {
  test("re-queues a known source by id and resets workflowStatus", async () => {
    process.env = { ...originalEnv, NIM_API_KEY: "", HYDRA_API_KEY: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          "<html><head><title>Retry source</title></head><body><article><p>GPT-5 shipped in May 2026.</p></article></body></html>",
      })
    );

    const { retryIngest } = await import("@/app/ingest/actions");
    const { registerDemoIngest, getSource, updateSourceWorkflowStatus } = await import("@/lib/app-service");

    const source = await registerDemoIngest("https://example.com/retry-source");
    await updateSourceWorkflowStatus(source.id, "failed_fetch");

    const form = new FormData();
    form.set("sourceId", source.id);
    await expect(retryIngest(form)).rejects.toThrow("NEXT_REDIRECT");

    const after = await getSource(source.id);
    expect(after?.workflowStatus).toBe("complete");
  });

  test("no-ops when sourceId is missing", async () => {
    const { retryIngest } = await import("@/app/ingest/actions");
    const form = new FormData();
    await expect(retryIngest(form)).rejects.toThrow("NEXT_REDIRECT");
  });
});
