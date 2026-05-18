import Link from "next/link";
import { ListChecks, Search } from "lucide-react";
import { listSavedQueries } from "@/lib/app-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryForm } from "./query-form";

export default async function QueryPage() {
  const saved = await listSavedQueries(8);
  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Ask the wiki</CardTitle>
          <p className="text-sm text-muted-foreground">Synthesized answer with numbered citations + knowledge-graph trace.</p>
        </CardHeader>
        <CardContent>
          <QueryForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5" /> Recent saved queries</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {saved.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
              No queries saved yet. Ask one to start the list.
            </p>
          ) : (
            saved.map((query) => (
              <Link
                key={query.id}
                href={`/wiki/q/${query.slug}`}
                className="block rounded-md border bg-card/70 p-3 transition-colors hover:border-primary/40 hover:bg-card"
              >
                <div className="font-medium leading-6 line-clamp-1">{query.question}</div>
                <div className="mt-1 text-xs text-muted-foreground">{new Date(query.savedAt).toLocaleString()}</div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
