import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface NormalizedSource {
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  bodyText: string;
}

const DEFAULT_TEXT_LIMIT = 48_000;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ConsensusWiki/0.1";

export async function normalizeUrl(url: string): Promise<NormalizedSource> {
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    const isNetworkError = error instanceof TypeError;
    if (isAbort || isNetworkError) return normalizeViaJina(url);
    throw error;
  }
  clearTimeout(timer);
  if (!response.ok) {
    if (response.status === 403 || response.status === 429 || response.status >= 500) return normalizeViaJina(url);
    throw new Error(`Fetch failed: ${response.status}`);
  }
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const metadata = extractMetadata(dom.window.document, url);
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent) {
    return {
      title: article.title || metadata.title,
      publisher: metadata.publisher,
      publishedAt: metadata.publishedAt,
      bodyText: truncateText(article.textContent),
    };
  }
  return normalizeViaJina(url);
}

export async function normalizeViaJina(url: string): Promise<NormalizedSource> {
  const parsed = new URL(url);
  const jinaUrl = `https://r.jina.ai/${parsed.href}`;
  const response = await fetch(jinaUrl);
  if (!response.ok) throw new Error(`Jina fetch failed: ${response.status}`);
  const text = await response.text();
  const metadata = extractTextMetadata(text, url);
  return {
    title: metadata.title,
    publisher: metadata.publisher,
    publishedAt: metadata.publishedAt,
    bodyText: truncateText(text),
  };
}

export async function normalizePdf(file: File): Promise<NormalizedSource> {
  void file;
  return { title: "Uploaded PDF", publisher: "PDF upload", publishedAt: null, bodyText: "PDF text extraction is available for text PDFs in deployed runtime." };
}

export function truncateText(text: string, maxChars = DEFAULT_TEXT_LIMIT) {
  const normalized = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maxChars) return normalized;
  const half = Math.floor((maxChars - 80) / 2);
  return `${normalized.slice(0, half)}\n\n[...source truncated...]\n\n${normalized.slice(-half)}`;
}

function extractMetadata(document: Document, url: string) {
  const fallback = fallbackMetadata(url);
  const title =
    meta(document, "property", "og:title") ??
    meta(document, "name", "twitter:title") ??
    document.querySelector("title")?.textContent?.trim() ??
    fallback.title;
  const publisher =
    meta(document, "property", "og:site_name") ??
    meta(document, "name", "application-name") ??
    meta(document, "name", "publisher") ??
    fallback.publisher;
  const rawPublishedAt =
    meta(document, "property", "article:published_time") ??
    meta(document, "name", "date") ??
    meta(document, "name", "pubdate") ??
    document.querySelector("time[datetime]")?.getAttribute("datetime");

  return { title, publisher, publishedAt: normalizeDate(rawPublishedAt) };
}

function extractTextMetadata(text: string, url: string) {
  const fallback = fallbackMetadata(url);
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? text.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ?? fallback.title;
  const publishedAt = normalizeDate(text.match(/^Published(?: Time| Date)?:\s*(.+)$/im)?.[1]?.trim() ?? null);
  return { title, publisher: fallback.publisher, publishedAt };
}

function meta(document: Document, attr: "name" | "property", value: string) {
  return document.querySelector(`meta[${attr}="${value}"]`)?.getAttribute("content")?.trim() || null;
}

function normalizeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fallbackMetadata(url: string) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return { title: hostname, publisher: hostname };
}
