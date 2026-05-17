import { expect, test } from "@playwright/test";

test("dashboard and entity page render demo data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /wiki that shows/i })).toBeVisible();
  await page.getByRole("link", { name: /GPT-5/i }).click();
  await expect(page.getByRole("heading", { name: "GPT-5" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Contested claims/i })).toBeVisible();
  await expect(page.getByText("GPT-5 will not be released until late 2026.").first()).toBeVisible();
  await expect(page.getByText(/Excerpt chunk-/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Related evidence/i })).toBeVisible();
});

test("ingest page shows workflow status, failure handling, and PDF note", async ({ page }) => {
  await page.goto("/ingest");
  await expect(page.getByRole("heading", { name: /Ingest source/i })).toBeVisible();
  await expect(page.getByText(/Fetch and normalize/i).first()).toBeVisible();
  await expect(page.getByText(/failed_upload/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry failed step/i })).toBeVisible();
  await expect(page.getByText(/Text PDFs are supported/i)).toBeVisible();
});

test("query flow redirects to a saved wiki page with citations", async ({ page }) => {
  await page.goto("/query");
  await expect(page.getByRole("heading", { name: /Ask the wiki/i })).toBeVisible();
  await page.getByRole("link", { name: /Open saved GPT-5 release page/i }).click();
  await expect(page).toHaveURL(/\/wiki\/q\/gpt5-release-date$/);
  await expect(page.getByText("/wiki/q/gpt5-release-date")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Citations/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /OpenAI introduces GPT-5/i })).toBeVisible();
});

test("graph page renders with a clear table fallback", async ({ page }) => {
  await page.goto("/graph");
  await expect(page.getByRole("heading", { name: /Topic graph/i })).toBeVisible();
  await expect(page.getByText(/Table fallback is always available/i)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Relation" })).toBeVisible();
});
