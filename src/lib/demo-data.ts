import crypto from "node:crypto";
import type { Claim, ClaimRelation, Entity, EntityAlias, Lede, SavedQuery, Source, Topic } from "./types";

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function stableSourceId(topicId: string, url: string) {
  return sha256(`${topicId}|${url.trim()}`);
}

export function stableClaimId(sourceId: string, claimText: string) {
  return sha256(`${sourceId}|${claimText.trim()}`);
}

export const demoTopic: Topic = {
  id: "ai-industry",
  title: "AI industry",
  hydraSubTenantId: "wikithon-ai-industry",
  createdAt: "2026-05-16T00:00:00.000Z",
};

const sourceSpecs = [
  ["https://openai.com/index/introducing-gpt-5/", "OpenAI introduces GPT-5", "OpenAI", "2026-05-12T16:00:00.000Z"],
  ["https://example.com/ai-leaks/gpt-5-late-2026", "Leaked schedule points to late GPT-5 release", "AI Leaks", "2026-05-13T09:20:00.000Z"],
  ["https://example.com/frontiercode/gpt-5-results", "FrontierCode posts GPT-5 benchmark notes", "FrontierCode Lab", "2026-05-14T12:10:00.000Z"],
  ["https://example.com/modelwatch/benchmark-dispute", "Researchers dispute GPT-5 benchmark setup", "ModelWatch", "2026-05-15T18:45:00.000Z"],
  ["https://anthropic.com/news/claude-4-7", "Anthropic ships Claude 4.7", "Anthropic", "2026-05-10T15:30:00.000Z"],
  ["https://example.com/industry/sam-altman-gpt5", "Altman says GPT-5 rollout will be gradual", "Tech Ledger", "2026-05-11T10:00:00.000Z"],
] as const;

export const demoSources: Source[] = sourceSpecs.map(([url, title, publisher, publishedAt]) => ({
  id: stableSourceId(demoTopic.id, url),
  topicId: demoTopic.id,
  url,
  title,
  publisher,
  publishedAt,
  ingestedAt: publishedAt,
  hydraStatus: "success",
  workflowStatus: "complete",
  workflowRunId: `demo-${sha256(url).slice(0, 8)}`,
  bodyExcerpt: null,
}));

export const demoEntities: Entity[] = [
  ["gpt-5", "GPT-5", "MODEL"],
  ["openai", "OpenAI", "ORG"],
  ["sam-altman", "Sam Altman", "PERSON"],
  ["anthropic", "Anthropic", "ORG"],
  ["claude-4-7", "Claude 4.7", "MODEL"],
].map(([id, canonicalName, entityType]) => ({
  id,
  topicId: demoTopic.id,
  canonicalName,
  entityType: entityType as Entity["entityType"],
  hydraEntityId: `hydra-${id}`,
  firstSeen: "2026-05-10T00:00:00.000Z",
}));

export const demoAliases: EntityAlias[] = [
  { alias: "gpt5", entityId: "gpt-5" },
  { alias: "gpt 5", entityId: "gpt-5" },
  { alias: "open ai", entityId: "openai" },
  { alias: "claude 4.7", entityId: "claude-4-7" },
];

function sourceId(url: string) {
  return stableSourceId(demoTopic.id, url);
}

function claim(sourceUrl: string, entityId: string, claimText: string, stance: Claim["stance"] = "factual"): Claim {
  const id = stableClaimId(sourceId(sourceUrl), claimText);
  return {
    id,
    sourceId: sourceId(sourceUrl),
    entityId,
    claimText,
    stance,
    confidence: 0.84,
    chunkUuid: `chunk-${id.slice(0, 10)}`,
    evidenceQuote: null,
    extractedAt: "2026-05-16T00:00:00.000Z",
  };
}

export const demoClaims: Claim[] = [
  claim(sourceSpecs[0][0], "gpt-5", "OpenAI released GPT-5 as a generally available model in May 2026."),
  claim(sourceSpecs[5][0], "gpt-5", "Sam Altman said GPT-5 rollout would expand gradually after the May release."),
  claim(sourceSpecs[1][0], "gpt-5", "GPT-5 will not be released until late 2026.", "leak"),
  claim(sourceSpecs[2][0], "gpt-5", "GPT-5 scored 92.4 on the FrontierCode benchmark."),
  claim(sourceSpecs[3][0], "gpt-5", "The reported GPT-5 FrontierCode score used a non-public benchmark variant."),
  claim(sourceSpecs[0][0], "openai", "OpenAI positioned GPT-5 as its flagship reasoning model."),
  claim(sourceSpecs[5][0], "sam-altman", "Sam Altman described the GPT-5 launch as staged rather than instantaneous."),
  claim(sourceSpecs[4][0], "anthropic", "Anthropic released Claude 4.7 with stronger tool-use reliability."),
  claim(sourceSpecs[4][0], "claude-4-7", "Claude 4.7 improved long-context citation accuracy."),
];

function relation(aText: string, bText: string, relationType: ClaimRelation["relation"], rationale: string): ClaimRelation {
  const claimA = demoClaims.find((item) => item.claimText === aText)?.id;
  const claimB = demoClaims.find((item) => item.claimText === bText)?.id;
  if (!claimA || !claimB) throw new Error("Bad demo relation");
  return { claimA, claimB, relation: relationType, rationale, llmConfidence: 0.86, judgedAt: "2026-05-16T01:00:00.000Z" };
}

export const demoClaimRelations: ClaimRelation[] = [
  relation(
    "OpenAI released GPT-5 as a generally available model in May 2026.",
    "GPT-5 will not be released until late 2026.",
    "contradict",
    "One source says general availability happened in May 2026; the leak claims no release until late 2026."
  ),
  relation(
    "GPT-5 scored 92.4 on the FrontierCode benchmark.",
    "The reported GPT-5 FrontierCode score used a non-public benchmark variant.",
    "qualify",
    "The second claim does not deny the score, but limits how comparable it is."
  ),
  relation(
    "OpenAI released GPT-5 as a generally available model in May 2026.",
    "Sam Altman said GPT-5 rollout would expand gradually after the May release.",
    "agree",
    "Both claims support a May release while noting rollout shape."
  ),
];

export const demoLedes: Lede[] = [
  {
    entityId: "gpt-5",
    lede: "GPT-5 is the center of the current AI-industry dispute: official launch claims point to May 2026, while leak coverage argues the release window is later. Benchmark claims are also qualified by questions about test comparability.",
    sourceCountAtGen: 4,
    generatedAt: "2026-05-16T02:00:00.000Z",
  },
  {
    entityId: "openai",
    lede: "OpenAI appears in this topic through GPT-5 launch positioning and staged rollout comments from Sam Altman.",
    sourceCountAtGen: 2,
    generatedAt: "2026-05-16T02:00:00.000Z",
  },
  {
    entityId: "anthropic",
    lede: "Anthropic's Claude 4.7 release provides the comparison point for tool-use and long-context citation claims.",
    sourceCountAtGen: 1,
    generatedAt: "2026-05-16T02:00:00.000Z",
  },
];

export const demoSavedQueries: SavedQuery[] = [
  {
    id: "gpt5-release-date",
    topicId: demoTopic.id,
    slug: "gpt5-release-date",
    question: "what's contested about GPT-5 release date?",
    answerMd: "Two source clusters disagree. OpenAI-facing coverage says GPT-5 became generally available in May 2026, while leak coverage says the release will not happen until late 2026. The current consensus is therefore not a single date, but a contested release-window story.",
    citedSourceIds: [sourceId(sourceSpecs[0][0]), sourceId(sourceSpecs[1][0])],
    graphContext: null,
    savedAt: "2026-05-16T03:00:00.000Z",
  },
];
