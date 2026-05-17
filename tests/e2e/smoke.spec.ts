import { expect, test } from "@playwright/test";

test("dashboard and entity page render demo data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /wiki that shows/i })).toBeVisible();
  await page.getByRole("link", { name: /GPT-5/i }).click();
  await expect(page.getByRole("heading", { name: "GPT-5" })).toBeVisible();
  await expect(page.getByText("GPT-5 will not be released until late 2026.")).toBeVisible();
});

test("graph, ingest, and query pages render", async ({ page }) => {
  await page.goto("/graph");
  await expect(page.getByRole("heading", { name: /Topic graph/i })).toBeVisible();
  await page.goto("/ingest");
  await expect(page.getByRole("heading", { name: /Ingest source/i })).toBeVisible();
  await page.goto("/query");
  await expect(page.getByRole("heading", { name: /Ask the wiki/i })).toBeVisible();
});
