export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="h-10 w-2/3 animate-pulse rounded-md bg-muted/60" />
        <div className="h-24 w-full max-w-3xl animate-pulse rounded-lg bg-muted/40" />
      </div>
      <div className="space-y-3">
        <div className="h-6 w-48 animate-pulse rounded-md bg-muted/60" />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="h-44 animate-pulse rounded-lg bg-muted/40" />
          <div className="h-44 animate-pulse rounded-lg bg-muted/40" />
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted/60" />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="h-32 animate-pulse rounded-lg bg-muted/40" />
          <div className="h-32 animate-pulse rounded-lg bg-muted/40" />
        </div>
      </div>
    </div>
  );
}
