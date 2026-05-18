const block = "animate-pulse rounded-md border border-slate-300/60 bg-slate-200/70 shadow-inner";
const card = "animate-pulse rounded-lg border border-slate-300/60 bg-slate-200/60 shadow-inner";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <div className={`${block} h-7 w-2/3`} />
        <div className={`${block} mt-3 h-4 w-1/3`} />
        <div className="mt-6 space-y-2">
          <div className={`${block} h-4 w-full`} />
          <div className={`${block} h-4 w-11/12`} />
          <div className={`${block} h-4 w-10/12`} />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-6">
        <div className={`${block} h-6 w-44`} />
        <div className={`${card} mt-4 h-64`} />
      </div>
    </div>
  );
}
