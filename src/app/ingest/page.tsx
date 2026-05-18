import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { recheckHydra, retryIngest } from "./actions";
import { IngestForm } from "./ingest-form";
import { StatusPill } from "@/components/status-pill";
import { listSources } from "@/lib/app-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Source } from "@/lib/types";

export default async function IngestPage() {
  const sources = await listSources();
  const totals = countByWorkflow(sources);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="h-5 w-5" /> Ingest source</CardTitle>
          <p className="text-sm text-muted-foreground">Paste a URL or upload a PDF. Workflow runs in the background and appears below.</p>
        </CardHeader>
        <CardContent>
          <IngestForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Ingest log</CardTitle>
              <p className="text-sm text-muted-foreground">{sources.length} source{sources.length === 1 ? "" : "s"} tracked.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <CountChip label="complete" value={totals.complete} tone="success" />
              <CountChip label="in flight" value={totals.inFlight} tone="info" />
              <CountChip label="failed" value={totals.failed} tone="destructive" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">workflow: failed_upload</Badge>
              <Badge variant="destructive">workflow: failed_fetch</Badge>
              <Badge variant="outline">hydra: errored</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground">Failed runs keep their last completed step visible for debugging. Click the refresh icon next to any pill to re-check Hydra status.</p>
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
                <div className="flex shrink-0 items-start gap-1.5">
                  <StatusPill source={source} />
                  {source.hydraStatus === "queued" || source.hydraStatus === "in_progress" || source.hydraStatus === "errored" || source.hydraStatus === "unknown" ? (
                    <form action={recheckHydra}>
                      <input type="hidden" name="sourceId" value={source.id} />
                      <button
                        type="submit"
                        title="Re-check Hydra status now"
                        className="mt-7 inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-primary"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span className="sr-only">Re-check Hydra status</span>
                      </button>
                    </form>
                  ) : null}
                </div>
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

function countByWorkflow(sources: Source[]) {
  let complete = 0;
  let inFlight = 0;
  let failed = 0;
  for (const s of sources) {
    if (s.workflowStatus === "complete") complete++;
    else if (isFailed(s.workflowStatus)) failed++;
    else inFlight++;
  }
  return { complete, inFlight, failed };
}

function CountChip({ label, value, tone }: { label: string; value: number; tone: "success" | "info" | "destructive" }) {
  const styles = {
    success: "border-emerald-300 bg-emerald-50 text-emerald-700",
    info: "border-amber-300 bg-amber-50 text-amber-700",
    destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${styles}`}>
      <span className="tabular-nums">{value}</span>
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  );
}
