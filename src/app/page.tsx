import Link from "next/link";
import { ArrowRight, FileText, GitBranch, ShieldAlert } from "lucide-react";
import { getDashboard } from "@/lib/app-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const dashboard = await getDashboard();
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-5">
          <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            A wiki that shows where sources agree, disagree, and stand alone.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            Seed topic: AI industry news. Ingest sources, extract atomic claims, surface contradictions, and watch the topic graph grow.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild><Link href="/ingest">Ingest source <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline"><Link href="/graph">Open graph</Link></Button>
          </div>
        </div>
        <Card>
          <CardHeader><CardTitle>{dashboard.topic.title}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <Stat label="Entities" value={dashboard.stats.entities} />
            <Stat label="Claims" value={dashboard.stats.claims} />
            <Stat label="Contradictions" value={dashboard.stats.contradictions} />
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
            {dashboard.entities.map((entity) => (
              <Link key={entity.id} href={`/wiki/${entity.id}`} className="flex items-center justify-between gap-4 py-4 hover:text-primary">
                <div><div className="font-medium">{entity.canonicalName}</div><div className="text-sm text-muted-foreground">{entity.entityType}</div></div>
                <div className="flex gap-2"><Badge>{entity.claimCount} claims</Badge>{entity.contestedCount > 0 ? <Badge variant="destructive">{entity.contestedCount} contested</Badge> : null}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent sources</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {dashboard.sources.map((source) => (
              <div key={source.id} className="rounded-md border bg-card p-3">
                <div className="font-medium leading-6">{source.title}</div>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>{source.publisher}</span><Badge variant="secondary">{source.hydraStatus}</Badge>
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
  return <div className="rounded-md border bg-muted/50 p-3"><div className="text-2xl font-semibold">{value}</div><div className="text-xs font-medium uppercase text-muted-foreground">{label}</div></div>;
}

function InfoCard({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return <Card><CardContent className="flex gap-3 p-5"><Icon className="mt-1 h-5 w-5 text-primary" /><div><div className="font-semibold">{title}</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></CardContent></Card>;
}
