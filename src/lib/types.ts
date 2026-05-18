export type EntityType = "PERSON" | "ORG" | "PRODUCT" | "EVENT" | "MODEL";
export type ClaimStance = "factual" | "opinion" | "prediction" | "leak" | "rumor";
export type ClaimRelationType = "agree" | "contradict" | "qualify" | "unrelated";
export type HydraStatus = "queued" | "in_progress" | "success" | "errored" | "unknown";
export type WorkflowStatus = "pending" | "extracting" | "judging" | "complete" | "failed_fetch" | "failed_upload";

export interface Topic {
  id: string;
  title: string;
  hydraSubTenantId: string;
  createdAt: string;
}

export interface Source {
  id: string;
  topicId: string;
  url: string | null;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  hydraStatus: HydraStatus;
  workflowStatus: WorkflowStatus;
  workflowRunId: string | null;
  bodyExcerpt: string | null;
}

export interface Entity {
  id: string;
  topicId: string;
  canonicalName: string;
  entityType: EntityType;
  hydraEntityId: string | null;
  firstSeen: string;
}

export interface EntityAlias {
  alias: string;
  entityId: string;
}

export interface Claim {
  id: string;
  sourceId: string;
  entityId: string;
  claimText: string;
  stance: ClaimStance;
  confidence: number | null;
  chunkUuid: string | null;
  evidenceQuote: string | null;
  extractedAt: string;
}

export interface ClaimRelation {
  claimA: string;
  claimB: string;
  relation: ClaimRelationType;
  rationale: string | null;
  llmConfidence: number | null;
  judgedAt: string;
}

export interface Lede {
  entityId: string;
  lede: string;
  sourceCountAtGen: number;
  generatedAt: string;
}

export interface QueryTripletEntity {
  name: string;
  type?: string;
  entityId?: string;
}

export interface QueryTriplet {
  source: QueryTripletEntity;
  target: QueryTripletEntity;
  predicate: string;
  context?: string | null;
  hops?: number;
}

export type QueryGraphSource = "hydra" | "local";

export interface QueryGraphContext {
  triplets: QueryTriplet[];
  source: QueryGraphSource;
}

export interface SavedQuery {
  id: string;
  topicId: string;
  slug: string;
  question: string;
  answerMd: string;
  citedSourceIds: string[];
  graphContext: QueryGraphContext | null;
  savedAt: string;
}

export interface CitedClaim extends Claim {
  source: Source;
}

export interface ContestedClaim {
  claim: CitedClaim;
  opposingClaims: CitedClaim[];
  relations: ClaimRelation[];
}

export interface ClaimGroups {
  established: CitedClaim[];
  contested: ContestedClaim[];
  singleSource: CitedClaim[];
}

export interface EntityPage {
  topic: Topic;
  entity: Entity;
  aliases: EntityAlias[];
  lede: Lede | null;
  sources: Source[];
  claims: CitedClaim[];
  relations: ClaimRelation[];
  groups: ClaimGroups;
  timeline: Source[];
}

export interface DashboardEntity extends Entity {
  claimCount: number;
  contestedCount: number;
}

export interface DashboardData {
  topic: Topic;
  stats: { entities: number; claims: number; sources: number; contradictions: number };
  entities: DashboardEntity[];
  sources: Source[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType | "SOURCE";
  claimCount?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: ClaimRelationType | "mentions" | "cites";
  label: string;
  rationale?: string | null;
}

export interface GraphData {
  topic: Topic;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
