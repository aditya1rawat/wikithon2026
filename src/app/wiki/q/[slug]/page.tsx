import { notFound } from "next/navigation";
import { getSavedQuery } from "@/lib/app-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SavedQueryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const query = await getSavedQuery(slug);
  if (!query) notFound();
  return (
    <Card>
      <CardHeader><CardTitle>{query.question}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="leading-8">{query.answerMd}</p>
        <div className="text-sm text-muted-foreground">Cited sources: {query.citedSourceIds.length}</div>
      </CardContent>
    </Card>
  );
}
