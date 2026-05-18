import { Loader2 } from "lucide-react";

export function RouteLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 rounded-xl border bg-card/40 px-6 py-16 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      <div className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">{label}</p>
        <p className="text-xs text-muted-foreground">Pulling claims, recall chunks, and the knowledge-graph context.</p>
      </div>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-muted/60">
        <div className="route-loading-bar h-full w-1/2 rounded-full bg-gradient-to-r from-primary via-primary/80 to-primary/40" />
      </div>
    </div>
  );
}
