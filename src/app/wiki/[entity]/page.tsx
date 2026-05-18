import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, GitBranch, Quote, ShieldAlert, Sparkles } from "lucide-react";
import { getEntityPage } from "@/lib/app-service";
import { excerptFor, getChunksForEntity, type ChunksBySource } from "@/lib/recall";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CitedClaim, ContestedClaim } from "@/lib/types";

const INTERNAL_RATIONALE_RE = /fallback (used|because)|provider (was )?unavailable/i;

function visibleRationale(rationale: string | null | undefined) {
  if (!rationale) return null;
  if (INTERNAL_RATIONALE_RE.test(rationale)) return null;
  return rationale;
}

export default async function EntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const page = await getEntityPage(entity);
  if (!page) notFound();
  const chunksBySource = await getChunksForEntity(page.entity.canonicalName, page.topic.hydraSubTenantId);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{page.entity.canonicalName}</h1>
          <Badge variant="secondary" className="text-xs uppercase tracking-wide">{page.entity.entityType}</Badge>
        </div>
        {page.lede?.lede ? (
          <div className="relative max-w-3xl rounded-lg border-l-4 border-primary bg-card/70 px-5 py-4 shadow-sm">
            <Sparkles className="absolute -left-3 top-4 h-5 w-5 rounded-full bg-primary p-1 text-primary-foreground" />
            <p className="text-lg leading-8 text-foreground/90">{page.lede.lede}</p>
            <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
              Synthesized · {page.lede.sourceCountAtGen} sources
            </p>
          </div>
        ) : (
          <p className="max-w-3xl rounded-lg border border-dashed bg-muted/30 px-5 py-4 text-sm text-muted-foreground">
            No lede yet. Ingest more sources to synthesize one.
          </p>
        )}
      </section>

      <ClaimSection
        title="Contested claims"
        subtitle="Claims with contradiction relations are shown side by side with source-backed excerpts."
        icon={ShieldAlert}
        count={page.groups.contested.length}
        urgent
      >
        <div className="space-y-4">
          {page.groups.contested.length ? (
            page.groups.contested.map((item) => <ContestedCard key={item.claim.id} item={item} chunks={chunksBySource} />)
          ) : (
            <Empty text="No contested claims yet. Ingest more sources." />
          )}
        </div>
      </ClaimSection>

      <ClaimSection
        title="Established claims"
        subtitle="Claims supported by multiple sources or agreement relations, with no contradiction attached."
        icon={Sparkles}
        count={page.groups.established.length}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {page.groups.established.length ? (
            page.groups.established.map((claim) => <ClaimCard key={claim.id} claim={claim} chunks={chunksBySource} />)
          ) : (
            <Empty text="No established claims yet." />
          )}
        </div>
      </ClaimSection>

      <ClaimSection
        title="Single-source claims"
        subtitle="Useful but isolated claims waiting for another source."
        icon={Quote}
        count={page.groups.singleSource.length}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {page.groups.singleSource.length ? (
            page.groups.singleSource.map((claim) => <ClaimCard key={claim.id} claim={claim} chunks={chunksBySource} />)
          ) : (
            <Empty text="No single-source claims yet." />
          )}
        </div>
      </ClaimSection>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Related evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {page.relations.length ? (
            page.relations.map((relation) => {
              const claimA = page.claims.find((claim) => claim.id === relation.claimA);
              const claimB = page.claims.find((claim) => claim.id === relation.claimB);
              return (
                <div key={`${relation.claimA}-${relation.claimB}`} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_auto_1fr]">
                  <MiniClaim claim={claimA} />
                  <div className="flex items-center justify-center">
                    <Badge variant={relation.relation === "contradict" ? "destructive" : "secondary"}>{relation.relation}</Badge>
                  </div>
                  <MiniClaim claim={claimB} />
                  {visibleRationale(relation.rationale) ? <p className="text-sm text-muted-foreground md:col-span-3">{visibleRationale(relation.rationale)}</p> : null}
                </div>
              );
            })
          ) : (
            <Empty text="No related claim edges yet." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="border-l pl-5">
            {page.timeline.map((source) => (
              <li key={source.id} className="relative pb-5 last:pb-0">
                <div className="absolute -left-[1.65rem] mt-1.5 h-3 w-3 rounded-full border bg-background" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{source.title}</span>
                  <Badge variant="outline">{source.hydraStatus}</Badge>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {source.publisher} · {source.publishedAt?.slice(0, 10) ?? "undated"}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function ClaimSection({
  title,
  subtitle,
  count,
  icon: Icon,
  urgent = false,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  urgent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Icon className="h-5 w-5" /> {title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{subtitle}</p>
        </div>
        <Badge variant={urgent && count > 0 ? "destructive" : "secondary"}>{count} claims</Badge>
      </div>
      {children}
    </section>
  );
}

function ClaimCard({ claim, chunks }: { claim: CitedClaim; chunks?: ChunksBySource }) {
  const sourceLabel = `${claim.source.publisher ?? "Unknown source"} · ${claim.source.title}`;
  const evidence = claim.evidenceQuote?.trim() || null;
  const recalled = chunks?.[claim.sourceId];
  const cached = claim.source.bodyExcerpt?.trim() || null;
  const excerptText = evidence ?? recalled ?? cached;
  const excerptSource: "evidence" | "hydra" | "cache" | null = evidence
    ? "evidence"
    : recalled
      ? "hydra"
      : cached
        ? "cache"
        : null;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <Quote className="h-4 w-4 text-primary" />
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{claim.stance}</Badge>
            {claim.confidence ? <Badge variant="secondary">{Math.round(claim.confidence * 100)}% confidence</Badge> : null}
          </div>
        </div>
        <p className="leading-7">{claim.claimText}</p>
        {excerptText ? (
          <blockquote className="rounded-md border-l-4 border-primary/40 bg-primary/5 px-3 py-2 text-sm leading-6 text-foreground/80">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-primary/80">
              {excerptSource === "evidence"
                ? "Evidence quote"
                : excerptSource === "hydra"
                  ? "Source excerpt"
                  : "Source excerpt (cached body)"}
            </span>
            <span className="mt-1 block">“{excerptFor(excerptText)}”</span>
          </blockquote>
        ) : claim.chunkUuid ? (
          <div className="rounded-md border-l-4 bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">Citation chunk: {claim.chunkUuid}</div>
        ) : (
          <div className="rounded-md border-l-4 bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">Citation chunk pending; source excerpt not yet available.</div>
        )}
        {claim.source.url ? (
          <Link
            href={claim.source.url}
            title={sourceLabel}
            className="block text-sm font-medium text-primary hover:underline line-clamp-2"
          >
            {sourceLabel}
          </Link>
        ) : (
          <div className="text-sm text-muted-foreground line-clamp-2" title={sourceLabel}>{sourceLabel}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ContestedCard({ item, chunks }: { item: ContestedClaim; chunks?: ChunksBySource }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">Disagreement noted</Badge>
          <span className="text-sm text-muted-foreground">Both sides remain source-backed until more evidence resolves the conflict.</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Claim</div>
            <ClaimCard claim={item.claim} chunks={chunks} />
          </div>
          {item.opposingClaims.map((claim) => (
            <div key={claim.id} className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Opposing source</div>
              <ClaimCard claim={claim} chunks={chunks} />
            </div>
          ))}
        </div>
        {visibleRationale(item.relations[0]?.rationale) ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{visibleRationale(item.relations[0]?.rationale)}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MiniClaim({ claim }: { claim?: CitedClaim }) {
  if (!claim) return <div className="text-sm text-muted-foreground">Claim no longer present in this page cache.</div>;
  return (
    <div>
      <p className="text-sm leading-6">{claim.claimText}</p>
      <div className="mt-1 text-xs text-muted-foreground">{claim.source.publisher} · {claim.source.publishedAt?.slice(0, 10) ?? "undated"}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border bg-card p-6 text-muted-foreground">{text}</div>;
}
