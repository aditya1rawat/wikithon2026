import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizeUrl } from "@/lib/normalize-source";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source normalization", () => {
  test("falls back to Jina on primary fetch rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "# Fallback title\n\nPublished Date: 2026-05-16\n\nBody from Jina",
      });
    vi.stubGlobal("fetch", fetchMock);

    const normalized = await normalizeUrl("https://example.com/article");

    expect(normalized.title).toBe("Fallback title");
    expect(normalized.bodyText).toContain("Body from Jina");
    expect(fetchMock.mock.calls[1][0]).toBe("https://r.jina.ai/https://example.com/article");
  });

  test("falls back to Jina on blocked primary status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "# Jina title\n\nBody from Jina",
      });
    vi.stubGlobal("fetch", fetchMock);

    const normalized = await normalizeUrl("https://example.com/blocked");

    expect(normalized.title).toBe("Jina title");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
