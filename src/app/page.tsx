import Link from "next/link";
import { ArrowRight, FileText, GitBranch, ShieldAlert } from "lucide-react";
import { getDashboard } from "@/lib/app-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/status-pill";
import type { DashboardData } from "@/lib/types";

function rankEntities(entities: DashboardData["entities"]) {
  return [...entities].sort((a, b) => {
    const score = (e: DashboardData["entities"][number]) => e.claimCount + e.contestedCount * 3;
    return score(b) - score(a);
  });
}

export default async function DashboardPage() {
  const dashboard = await getDashboard();
  const rankedEntities = rankEntities(dashboard.entities);
  const topEntities = rankedEntities.slice(0, 12);
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-primary" /> Live · {dashboard.topic.title}
          </span>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            A wiki that shows where sources <span className="text-primary">agree</span>, <span className="text-destructive">disagree</span>, and stand alone.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            Ingest sources, extract atomic claims, surface contradictions, and watch the topic graph grow.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="px-6 text-base shadow-md hover:shadow-lg">
              <Link href="/ingest">Ingest source <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="px-6 text-base font-semibold">
              <Link href="/graph">Open graph</Link>
            </Button>
          </div>
        </div>
        <Card className="flex flex-col border-primary/10 bg-gradient-to-br from-card to-primary/5 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle>Topic stats</CardTitle>
            <p className="text-xs text-muted-foreground">Live counts from the current ingest corpus.</p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Entities" value={dashboard.stats.entities} />
              <Stat label="Claims" value={dashboard.stats.claims} />
              <Stat label="Sources" value={dashboard.stats.sources} />
            </div>
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-destructive/80">Contradictions</span>
                <span className={`text-2xl font-semibold tabular-nums ${dashboard.stats.contradictions > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {dashboard.stats.contradictions}
                </span>
              </div>
              <p className="mt-1 text-xs text-destructive/70">
                Distinct contradict pairs across all entities.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard icon={FileText} title="Established" text="Multiple sources align and no contradiction relation is present." />
        <InfoCard icon={ShieldAlert} title="Contested" text="Claims collide with opposing source-backed claims and rationale." />
        <InfoCard icon={GitBranch} title="Single-source" text="Useful but isolated claims waiting for another source." />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Entities</CardTitle>
            <Badge variant="secondary">{dashboard.entities.length} tracked</Badge>
          </CardHeader>
          <CardContent className="divide-y">
            {topEntities.map((entity) => (
              <Link key={entity.id} href={`/wiki/${entity.id}`} className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3 transition-colors hover:bg-muted/40 hover:text-primary">
                <div><div className="font-medium">{entity.canonicalName}</div><div className="text-sm text-muted-foreground">{entity.entityType}</div></div>
                <div className="flex shrink-0 gap-2"><Badge>{entity.claimCount} claims</Badge>{entity.contestedCount > 0 ? <Badge variant="destructive">{entity.contestedCount} contested</Badge> : null}</div>
              </Link>
            ))}
            {rankedEntities.length > 12 ? (
              <div className="pt-3 text-xs text-muted-foreground">
                Showing top 12 of {rankedEntities.length} tracked entities — ranked by claims and contested count.
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent sources</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {dashboard.sources.map((source) => (
              <div key={source.id} className="rounded-md border bg-card p-3">
                <div className="font-medium leading-6 line-clamp-2" title={source.title}>{source.title}</div>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>{source.publisher}</span>
                  <StatusPill source={source} compact />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background/60 p-3 backdrop-blur-sm">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function InfoCard({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return <Card><CardContent className="flex gap-3 p-5"><Icon className="mt-1 h-5 w-5 text-primary" /><div><div className="font-semibold">{title}</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></CardContent></Card>;
}
