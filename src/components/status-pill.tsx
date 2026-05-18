import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import type { Source } from "@/lib/types";

export function StatusPill({ source, compact = false }: { source: Source; compact?: boolean }) {
  const wf = source.workflowStatus;
  const hydra = source.hydraStatus;
  const workflowFailed = wf === "failed_fetch" || wf === "failed_upload";
  const wfActive = wf === "extracting" || wf === "judging" || wf === "pending";
  return (
    <div className={`flex shrink-0 ${compact ? "flex-wrap items-center gap-1.5" : "flex-col items-end gap-1.5"}`}>
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${
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
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${
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
