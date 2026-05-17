import { AlertTriangle, CheckCircle2, Clock3, FileText, RotateCcw, UploadCloud } from "lucide-react";
import { ingestSource } from "./actions";
import { listSources } from "@/lib/app-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { HydraStatus, Source } from "@/lib/types";

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
              <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                Text PDFs are supported in v1. Scanned PDFs without embedded text need OCR and remain a stretch item.
              </p>
            </div>
            <Button type="submit">Queue ingest</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ingest log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">failed_upload</Badge>
              <Badge variant="outline">failed_fetch</Badge>
              <Badge variant="outline">hydra_errored</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground">Failed runs keep their last completed step visible for debugging.</p>
              <Button type="button" size="sm" variant="outline" disabled>
                <RotateCcw className="h-4 w-4" /> Retry failed step
              </Button>
            </div>
          </div>
          {sources.map((source) => (
            <div key={source.id} className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium leading-6">{source.title}</div>
                  <div className="text-sm text-muted-foreground">{source.publisher} · {source.publishedAt?.slice(0, 10) ?? "undated"}</div>
                </div>
                <StatusBadge status={source.hydraStatus} />
              </div>
              <WorkflowTimeline source={source} />
              {isFailed(source.hydraStatus) ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm text-destructive">Pipeline stopped at {source.hydraStatus}. Retry will re-run from the failed step.</p>
                  <Button type="button" size="sm" variant="outline">
                    <RotateCcw className="h-4 w-4" /> Retry failed step
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowTimeline({ source }: { source: Source }) {
  const steps = buildSteps(source.hydraStatus);
  return (
    <ol className="mt-4 grid gap-2 sm:grid-cols-4">
      {steps.map((step) => {
        const StepIcon = step.icon;
        return (
          <li key={step.label} className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2">
              <StepIcon className={step.tone} />
              <span className="text-sm font-medium">{step.label}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

function buildSteps(status: HydraStatus) {
  const failed = isFailed(status);
  const active = status === "queued" || status === "in_progress";
  return [
    { label: "Fetch and normalize", detail: failed && status === "failed_fetch" ? "Fetch failed" : "Article/PDF text ready", icon: failed && status === "failed_fetch" ? AlertTriangle : CheckCircle2, tone: failed && status === "failed_fetch" ? "h-4 w-4 text-destructive" : "h-4 w-4 text-emerald-600" },
    { label: "Hydra upload", detail: status === "failed_upload" ? "Upload needs retry" : active ? "Waiting on upload" : "Knowledge accepted", icon: status === "failed_upload" ? AlertTriangle : active ? Clock3 : CheckCircle2, tone: status === "failed_upload" ? "h-4 w-4 text-destructive" : active ? "h-4 w-4 text-amber-600" : "h-4 w-4 text-emerald-600" },
    { label: "Hydra poll", detail: status === "hydra_errored" ? "Hydra returned errored" : status === "success" ? "Processing complete" : "Status pending", icon: status === "hydra_errored" ? AlertTriangle : status === "success" ? CheckCircle2 : Clock3, tone: status === "hydra_errored" ? "h-4 w-4 text-destructive" : status === "success" ? "h-4 w-4 text-emerald-600" : "h-4 w-4 text-amber-600" },
    { label: "Claims and graph", detail: status === "success" ? "Entity pages invalidated" : "Runs after Hydra success", icon: status === "success" ? CheckCircle2 : Clock3, tone: status === "success" ? "h-4 w-4 text-emerald-600" : "h-4 w-4 text-amber-600" },
  ];
}

function StatusBadge({ status }: { status: HydraStatus }) {
  if (isFailed(status)) return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant={status === "success" ? "secondary" : "outline"}>{status}</Badge>;
}

function isFailed(status: HydraStatus) {
  return status === "errored" || status === "failed_fetch" || status === "failed_upload" || status === "hydra_errored";
}
