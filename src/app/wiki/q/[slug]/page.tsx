import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { BookOpen, Link2 } from "lucide-react";
import { getSavedQuery, getSourcesByIds } from "@/lib/app-service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectionsUsed } from "@/components/connections-used";
import type { Source } from "@/lib/types";

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
          <div className="leading-8">
            <AnswerWithCitations text={query.answerMd} sources={citedSources} />
          </div>
        </CardContent>
      </Card>

      <ConnectionsUsed graphContext={query.graphContext} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Citations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {citedSources.length ? (
            citedSources.map((source, i) => (
              <div key={source.id} id={`cite-${i + 1}`} className="flex gap-3 rounded-md border p-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  {source.url ? (
                    <Link href={source.url} className="block font-medium text-primary hover:underline line-clamp-2" title={source.title}>
                      {source.title}
                    </Link>
                  ) : (
                    <div className="font-medium line-clamp-2" title={source.title}>{source.title}</div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{source.publisher ?? "Unknown publisher"}</span>
                    <span>{source.publishedAt?.slice(0, 10) ?? "undated"}</span>
                    <Badge variant="outline">{source.hydraStatus}</Badge>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border bg-card p-6 text-muted-foreground">No cited sources were stored with this saved answer.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnswerWithCitations({ text, sources }: { text: string; sources: Source[] }) {
  const max = sources.length;
  const parts = text.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
  return (
    <p>
      {parts.map((part, idx) => {
        const match = part.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/);
        if (!match) return <Fragment key={idx}>{part}</Fragment>;
        const nums = match[1].split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => n >= 1 && n <= max);
        if (!nums.length) return null;
        return (
          <sup key={idx} className="ml-0.5 text-xs font-medium">
            [
            {nums.map((n, i) => (
              <Fragment key={n}>
                {i > 0 ? ", " : null}
                <a
                  href={`#cite-${n}`}
                  className="text-primary hover:underline"
                  title={sources[n - 1]?.title}
                >
                  {n}
                </a>
              </Fragment>
            ))}
            ]
          </sup>
        );
      })}
    </p>
  );
}
