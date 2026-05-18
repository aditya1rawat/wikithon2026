export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted/60" />
        <div className="mt-3 h-4 w-1/3 animate-pulse rounded-md bg-muted/40" />
        <div className="mt-6 space-y-2">
          <div className="h-4 w-full animate-pulse rounded-md bg-muted/40" />
          <div className="h-4 w-11/12 animate-pulse rounded-md bg-muted/40" />
          <div className="h-4 w-10/12 animate-pulse rounded-md bg-muted/40" />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-6">
        <div className="h-6 w-44 animate-pulse rounded-md bg-muted/60" />
        <div className="mt-4 h-64 animate-pulse rounded-lg bg-muted/40" />
      </div>
    </div>
  );
}
