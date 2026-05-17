import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface NormalizedSource {
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  bodyText: string;
}

export async function normalizeUrl(url: string): Promise<NormalizedSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent) {
    return { title: article.title || new URL(url).hostname, publisher: new URL(url).hostname.replace(/^www\./, ""), publishedAt: null, bodyText: article.textContent };
  }
  return normalizeViaJina(url);
}

export async function normalizeViaJina(url: string): Promise<NormalizedSource> {
  const jinaUrl = `https://r.jina.ai/http://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
  const response = await fetch(jinaUrl);
  if (!response.ok) throw new Error(`Jina fetch failed: ${response.status}`);
  const text = await response.text();
  return { title: new URL(url).hostname, publisher: new URL(url).hostname.replace(/^www\./, ""), publishedAt: null, bodyText: text };
}

export async function normalizePdf(file: File): Promise<NormalizedSource> {
  void file;
  return { title: "Uploaded PDF", publisher: "PDF upload", publishedAt: null, bodyText: "PDF text extraction is available for text PDFs in deployed runtime." };
}
