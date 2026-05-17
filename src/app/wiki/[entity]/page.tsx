import { notFound } from "next/navigation";
import { CalendarDays, Quote } from "lucide-react";
import { getEntityPage } from "@/lib/app-service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CitedClaim, ContestedClaim } from "@/lib/types";

export default async function EntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const page = await getEntityPage(entity);
  if (!page) notFound();
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">{page.entity.canonicalName}</h1>
          <Badge variant="secondary">{page.entity.entityType}</Badge>
        </div>
        <p className="max-w-3xl text-lg leading-8 text-muted-foreground">{page.lede?.lede ?? "No lede yet. Ingest more sources to synthesize one."}</p>
      </section>
      <Tabs defaultValue="contested">
        <TabsList>
          <TabsTrigger value="established">Established ({page.groups.established.length})</TabsTrigger>
          <TabsTrigger value="contested">Contested ({page.groups.contested.length})</TabsTrigger>
          <TabsTrigger value="single">Single-source ({page.groups.singleSource.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="established" className="grid gap-3 md:grid-cols-2">
          {page.groups.established.length ? page.groups.established.map((claim) => <ClaimCard key={claim.id} claim={claim} />) : <Empty text="No established claims yet." />}
        </TabsContent>
        <TabsContent value="contested" className="space-y-4">
          {page.groups.contested.length ? page.groups.contested.map((item) => <ContestedCard key={item.claim.id} item={item} />) : <Empty text="No contested claims yet. Ingest more sources." />}
        </TabsContent>
        <TabsContent value="single" className="grid gap-3 md:grid-cols-2">
          {page.groups.singleSource.map((claim) => <ClaimCard key={claim.id} claim={claim} />)}
        </TabsContent>
      </Tabs>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Timeline</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {page.timeline.map((source) => <div key={source.id} className="flex justify-between gap-3 border-b pb-3 text-sm"><span>{source.title}</span><span className="text-muted-foreground">{source.publishedAt?.slice(0, 10)}</span></div>)}
        </CardContent>
      </Card>
    </div>
  );
}

function ClaimCard({ claim }: { claim: CitedClaim }) {
  return <Card><CardContent className="space-y-3 p-4"><Quote className="h-4 w-4 text-primary" /><p className="leading-7">{claim.claimText}</p><div className="text-sm text-muted-foreground">{claim.source.publisher} · {claim.source.title}</div></CardContent></Card>;
}

function ContestedCard({ item }: { item: ContestedClaim }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <ClaimCard claim={item.claim} />
          {item.opposingClaims.map((claim) => <ClaimCard key={claim.id} claim={claim} />)}
        </div>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{item.relations[0]?.rationale}</div>
      </CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border bg-card p-6 text-muted-foreground">{text}</div>;
}
