const STOPWORD_NAMES = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "as",
  "if",
  "for",
  "of",
  "on",
  "in",
  "at",
  "to",
  "by",
  "with",
  "from",
  "into",
  "onto",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "they",
  "them",
  "their",
  "this",
  "that",
  "these",
  "those",
  "he",
  "she",
  "him",
  "her",
  "his",
  "hers",
  "we",
  "us",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "i",
  "me",
  "my",
  "mine",
  "also",
  "due",
  "such",
  "any",
  "all",
  "some",
  "no",
  "not",
  "yes",
  "company",
  "companies",
  "people",
  "users",
  "developers",
  "reporter",
  "reporters",
  "today",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "monday",
  "saturday",
  "sunday",
  "yesterday",
  "tomorrow",
]);

/**
 * Reject canonical entity names that are clearly junk (stopwords, single
 * letters, lowercase-only words). The LLM occasionally emits filler tokens
 * like "The", "And", "If" as entity names — those should not produce wiki
 * pages.
 */
export function isValidEntityName(canonicalName: string): boolean {
  const trimmed = canonicalName?.trim();
  if (!trimmed) return false;
  if (trimmed.length < 2) return false;
  if (STOPWORD_NAMES.has(trimmed.toLowerCase())) return false;
  if (!/[A-Za-z0-9]/.test(trimmed)) return false;
  // Must contain at least one letter that is uppercase or be an all-caps
  // acronym; otherwise it is likely a fragment like "due", "its", "such".
  if (!/[A-Z]/.test(trimmed) && !/^\d/.test(trimmed)) return false;
  return true;
}
