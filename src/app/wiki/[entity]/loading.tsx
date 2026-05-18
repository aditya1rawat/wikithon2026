const block = "animate-pulse rounded-md border border-slate-300/60 bg-slate-200/70 shadow-inner";
const card = "animate-pulse rounded-lg border border-slate-300/60 bg-slate-200/60 shadow-inner";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className={`${block} h-10 w-2/3`} />
        <div className={`${card} h-24 w-full max-w-3xl`} />
      </div>
      <div className="space-y-3">
        <div className={`${block} h-6 w-48`} />
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`${card} h-44`} />
          <div className={`${card} h-44`} />
        </div>
      </div>
      <div className="space-y-3">
        <div className={`${block} h-6 w-40`} />
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`${card} h-32`} />
          <div className={`${card} h-32`} />
        </div>
      </div>
    </div>
  );
}
