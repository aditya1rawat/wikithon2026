import { Loader2 } from "lucide-react";

export function RouteLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="relative flex min-h-[60vh] flex-col items-center justify-center gap-6 overflow-hidden rounded-xl border bg-card/40 px-6 py-16 text-center">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 overflow-hidden">
        <div className="route-loading-stripe h-full w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_12px_var(--color-primary)]" />
      </div>
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <span className="absolute inset-2 rounded-full bg-primary/10" />
        <Loader2 className="relative h-7 w-7 animate-spin text-primary" />
      </div>
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
