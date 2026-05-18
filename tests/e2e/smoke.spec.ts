import { expect, test } from "@playwright/test";

test("dashboard renders entities and links to entity pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /wiki that shows/i })).toBeVisible();
  const firstEntityLink = page.locator('a[href^="/wiki/"]').first();
  await expect(firstEntityLink).toBeVisible();
  await firstEntityLink.click();
  await expect(page).toHaveURL(/\/wiki\/(?!q\/)[a-z0-9-]+/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test("ingest page shows workflow status, failure handling, and PDF note", async ({ page }) => {
  await page.goto("/ingest");
  await expect(page.getByRole("heading", { name: /Ingest source/i })).toBeVisible();
  await expect(page.getByText(/Fetch and normalize/i).first()).toBeVisible();
  await expect(page.getByText(/failed_upload/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry failed step/i })).toBeVisible();
  await expect(page.getByText(/Text PDFs are supported/i)).toBeVisible();
});

test("query form submits and lands on a saved wiki page", async ({ page }) => {
  test.skip(!process.env.NIM_API_KEY, "Requires NIM_API_KEY for live query synthesis");
  await page.goto("/query");
  await expect(page.getByRole("heading", { name: /Ask the wiki/i })).toBeVisible();
  await page.getByRole("textbox", { name: /Question/i }).fill("smoke test question " + Date.now());
  await page.getByRole("button", { name: /Synthesize and save/i }).click();
  await expect(page).toHaveURL(/\/wiki\/q\/[a-z0-9-]+/);
  await expect(page.getByRole("heading", { name: /smoke test question/i })).toBeVisible();
});

test("graph page renders with a clear table fallback", async ({ page }) => {
  await page.goto("/graph");
  await expect(page.getByRole("heading", { name: /Topic graph/i })).toBeVisible();
  await expect(page.getByText(/Table fallback is always available/i)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Relation" })).toBeVisible();
});
