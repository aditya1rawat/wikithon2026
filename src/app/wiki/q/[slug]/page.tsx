import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Link2 } from "lucide-react";
import { getSavedQuery, getSourcesByIds } from "@/lib/app-service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SavedQueryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const query = await getSavedQuery(slug);
  if (!query) notFound();

  const citedSources = await getSourcesByIds(query.citedSourceIds);
  const path = `/wiki/q/${query.slug}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" /> {query.question}</CardTitle>
            <Badge variant="secondary">Saved query</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <span className="font-medium">Saved page path</span>
            <div className="mt-1 font-mono text-muted-foreground">{path}</div>
          </div>
          <p className="leading-8">{query.answerMd}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Citations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {citedSources.length ? (
            citedSources.map((source) => (
              <div key={source.id} className="rounded-md border p-3">
                {source.url ? (
                  <Link href={source.url} className="font-medium text-primary hover:underline">
                    {source.title}
                  </Link>
                ) : (
                  <div className="font-medium">{source.title}</div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{source.publisher ?? "Unknown publisher"}</span>
                  <span>{source.publishedAt?.slice(0, 10) ?? "undated"}</span>
                  <Badge variant="outline">{source.hydraStatus}</Badge>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border bg-card p-6 text-muted-foreground">No cited source IDs were stored with this saved answer.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
