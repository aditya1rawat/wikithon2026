import { UploadCloud } from "lucide-react";
import { ingestSource } from "./actions";
import { listSources } from "@/lib/app-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default async function IngestPage() {
  const sources = await listSources();
  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UploadCloud className="h-5 w-5" /> Ingest source</CardTitle></CardHeader>
        <CardContent>
          <form action={ingestSource} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">Article URL</Label>
              <Input id="url" name="url" type="url" placeholder="https://example.com/ai-news/story" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pdf">PDF upload</Label>
              <Input id="pdf" name="pdf" type="file" accept="application/pdf" />
              <p className="text-xs text-muted-foreground">Text PDFs are v1; scanned OCR is stretch.</p>
            </div>
            <Button type="submit">Queue ingest</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Ingest log</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {sources.map((source) => (
            <div key={source.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-medium">{source.title}</div><div className="text-sm text-muted-foreground">{source.publisher} · {source.publishedAt?.slice(0, 10) ?? "undated"}</div></div>
                <Badge variant={source.hydraStatus === "success" ? "secondary" : "outline"}>{source.hydraStatus}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
