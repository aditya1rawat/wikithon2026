import { AlertTriangle, CheckCircle2, Clock3, FileText, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { ingestSource, retryIngest } from "./actions";
import { listSources } from "@/lib/app-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Source } from "@/lib/types";

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
              <Badge variant="destructive">workflow: failed_upload</Badge>
              <Badge variant="destructive">workflow: failed_fetch</Badge>
              <Badge variant="outline">hydra: errored</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground">Failed runs keep their last completed step visible for debugging.</p>
              <Button type="button" size="sm" variant="outline" disabled>
                <RotateCcw className="h-4 w-4" /> Retry failed step
              </Button>
            </div>
          </div>
          {sources.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              No sources yet. Queue one above to start the pipeline.
            </div>
          ) : null}
          {sources.map((source) => (
            <div key={source.id} className="animate-slide-up rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium leading-6">{source.title}</div>
                  <div className="text-sm text-muted-foreground">{source.publisher} · {source.publishedAt?.slice(0, 10) ?? "undated"}</div>
                </div>
                <StatusBadge source={source} />
              </div>
              <WorkflowTimeline source={source} />
              {(() => {
                const retryable = needsRetry(source);
                if (!retryable) return null;
                const failed = isFailed(source.workflowStatus);
                return (
                  <div className={`mt-3 flex items-center justify-between gap-3 rounded-md border p-3 ${failed ? "border-destructive/30 bg-destructive/5" : "border-amber-300 bg-amber-50/60"}`}>
                    <p className={`text-sm ${failed ? "text-destructive" : "text-amber-800"}`}>
                      {failed
                        ? `Pipeline stopped at ${source.workflowStatus}. Retry will re-run from the failed step.`
                        : `Workflow has been ${source.workflowStatus} for over 5 minutes. Hydra may be stalled — retry runs local extraction immediately.`}
                    </p>
                    <form action={retryIngest}>
                      <input type="hidden" name="sourceId" value={source.id} />
                      <Button type="submit" size="sm" variant="outline">
                        <RotateCcw className="h-4 w-4" /> {failed ? "Retry failed step" : "Force retry"}
                      </Button>
                    </form>
                  </div>
                );
              })()}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowTimeline({ source }: { source: Source }) {
  const steps = buildSteps(source);
  return (
    <ol className="mt-4 grid gap-2 sm:grid-cols-4">
      {steps.map((step, idx) => {
        const StepIcon = step.icon;
        const stateStyles = {
          done: "border-emerald-200 bg-emerald-50/60",
          pending: "border-amber-200 bg-amber-50/40",
          error: "border-destructive/30 bg-destructive/5",
        }[step.state];
        return (
          <li key={step.label} className={`relative rounded-md border p-3 transition-colors ${stateStyles}`}>
            <div className="flex items-center gap-2">
              <StepIcon className={`${step.tone} ${step.state === "pending" ? "animate-pulse-soft" : ""}`} />
              <span className="text-sm font-medium">{step.label}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
            <span className="absolute right-2 top-2 text-[10px] font-mono text-muted-foreground/60">{idx + 1}</span>
          </li>
        );
      })}
    </ol>
  );
}

function buildSteps(source: Source) {
  const wf = source.workflowStatus;
  const hydra = source.hydraStatus;
  const fetchState: StepState = wf === "failed_fetch" ? "error" : "done";
  const uploadState: StepState = wf === "failed_upload" ? "error" : wf === "pending" ? "pending" : "done";
  const hydraState: StepState = hydra === "errored" ? "error" : hydra === "success" ? "done" : "pending";
  const extractState: StepState =
    wf === "complete" ? "done" : wf === "extracting" || wf === "judging" ? "pending" : wf === "failed_fetch" || wf === "failed_upload" ? "error" : "pending";

  return [
    step("Fetch and normalize", fetchState === "error" ? "Fetch failed" : "Article/PDF text ready", fetchState),
    step("Hydra upload", uploadState === "error" ? "Upload needs retry" : uploadState === "pending" ? "Waiting on upload" : "Knowledge accepted", uploadState),
    step("Hydra poll", hydraState === "error" ? "Hydra returned errored" : hydraState === "done" ? "Hydra processing complete" : `Hydra ${hydra}`, hydraState),
    step("Claims and graph", extractState === "done" ? "Claims persisted, entity pages invalidated" : extractState === "error" ? "Pipeline halted" : `Workflow ${wf}`, extractState),
  ];
}

type StepState = "done" | "pending" | "error";

function step(label: string, detail: string, state: StepState) {
  const icon = { done: CheckCircle2, pending: Loader2, error: AlertTriangle }[state];
  const tone = {
    done: "h-4 w-4 text-emerald-600",
    pending: "h-4 w-4 text-amber-600",
    error: "h-4 w-4 text-destructive",
  }[state];
  return { label, detail, icon, tone, state };
}

function StatusBadge({ source }: { source: Source }) {
  const wf = source.workflowStatus;
  const hydra = source.hydraStatus;
  const workflowFailed = wf === "failed_fetch" || wf === "failed_upload";
  const wfActive = wf === "extracting" || wf === "judging" || wf === "pending";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          workflowFailed
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : wf === "complete"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
        }`}
      >
        {wfActive ? <Clock3 className="h-3 w-3 animate-pulse-soft" /> : workflowFailed ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        workflow · {wf}
      </span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          hydra === "errored"
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : hydra === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-slate-300 bg-slate-50 text-slate-600"
        }`}
      >
        hydra · {hydra}
      </span>
    </div>
  );
}

function isFailed(status: Source["workflowStatus"]) {
  return status === "failed_fetch" || status === "failed_upload";
}

const STALE_PENDING_MS = 5 * 60 * 1000;

function needsRetry(source: Source) {
  if (isFailed(source.workflowStatus)) return true;
  if (source.workflowStatus === "pending" || source.workflowStatus === "extracting") {
    const ingestedAt = Date.parse(source.ingestedAt);
    if (Number.isNaN(ingestedAt)) return false;
    return Date.now() - ingestedAt > STALE_PENDING_MS;
  }
  return false;
}
