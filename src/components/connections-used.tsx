"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { ArrowRight } from "lucide-react";
import type { QueryGraphContext, QueryTriplet } from "@/lib/types";

const TYPE_COLOR_FALLBACK = "#1554a5";
const TYPE_COLORS: Record<string, string> = {
  PERSON: "#0f9b6e",
  ORGANIZATION: "#7e5bef",
  ORG: "#7e5bef",
  PRODUCT: "#c4651a",
  PROJECT: "#c4651a",
  MODEL: "#1554a5",
  EVENT: "#b03a8a",
};

export function ConnectionsUsed({ graphContext }: { graphContext: QueryGraphContext | null }) {
  const triplets = graphContext?.triplets ?? [];
  const oneStep = useMemo(() => triplets.filter((t) => (t.hops ?? 1) === 1), [triplets]);
  const multiStep = useMemo(() => triplets.filter((t) => (t.hops ?? 1) > 1), [triplets]);
  const hasBoth = oneStep.length > 0 && multiStep.length > 0;
  const [mode, setMode] = useState<"1-step" | "multi-step">(oneStep.length > 0 ? "1-step" : "multi-step");

  const shown = mode === "1-step" ? oneStep : [...oneStep, ...multiStep];

  if (triplets.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Connections used</h2>
        {hasBoth ? (
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode("1-step")}
              className={`rounded px-3 py-1 transition-colors ${mode === "1-step" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              1-step ({oneStep.length})
            </button>
            <button
              type="button"
              onClick={() => setMode("multi-step")}
              className={`rounded px-3 py-1 transition-colors ${mode === "multi-step" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              Multi-step ({triplets.length})
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{triplets.length} relation{triplets.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <TripletGraph triplets={shown} />
      <div className="mt-4 space-y-2">
        {shown.map((t, idx) => (
          <TripletRow key={`${t.source.name}-${t.predicate}-${t.target.name}-${idx}`} triplet={t} />
        ))}
      </div>
    </div>
  );
}

function TripletGraph({ triplets }: { triplets: QueryTriplet[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container || triplets.length === 0) return;
    let cy: cytoscape.Core | null = null;
    try {
      const nodeMap = new Map<string, { id: string; label: string; color: string }>();
      const edges: { id: string; source: string; target: string; label: string }[] = [];
      triplets.forEach((t, idx) => {
        const srcId = t.source.name;
        const tgtId = t.target.name;
        if (!nodeMap.has(srcId)) nodeMap.set(srcId, { id: srcId, label: t.source.name, color: TYPE_COLORS[t.source.type ?? ""] ?? TYPE_COLOR_FALLBACK });
        if (!nodeMap.has(tgtId)) nodeMap.set(tgtId, { id: tgtId, label: t.target.name, color: TYPE_COLORS[t.target.type ?? ""] ?? TYPE_COLOR_FALLBACK });
        edges.push({ id: `e-${idx}`, source: srcId, target: tgtId, label: t.predicate });
      });
      cy = cytoscape({
        container,
        elements: [
          ...[...nodeMap.values()].map((n) => ({ data: n })),
          ...edges.map((e) => ({ data: e })),
        ],
        style: [
          { selector: "node", style: { label: "data(label)", "background-color": "data(color)", "border-width": 2, "border-color": "#ffffff", color: "#0b1726", "font-size": 11, "font-weight": 500, width: 28, height: 28, "text-valign": "top", "text-margin-y": -8, "text-outline-width": 2, "text-outline-color": "#f6f8fb" } },
          { selector: "edge", style: { label: "data(label)", width: 1.5, "line-color": "#94a3b8", "target-arrow-shape": "triangle", "target-arrow-color": "#94a3b8", "curve-style": "bezier", "font-size": 9, color: "#4b5868", "text-rotation": "autorotate", "text-background-color": "#ffffff", "text-background-opacity": 0.85, "text-background-padding": "2px" } },
        ],
        layout: triplets.length <= 2
          ? { name: "grid", rows: 1, padding: 30 }
          : { name: "concentric", animate: false, padding: 30, minNodeSpacing: 40 },
      });
      requestAnimationFrame(() => {
        try {
          cy?.resize();
          cy?.fit(undefined, 30);
        } catch {
          // ignore
        }
      });
    } catch (error) {
      console.error("[connections] cytoscape init failed:", error);
      queueMicrotask(() => setFailed(true));
    }
    return () => {
      cy?.destroy();
    };
  }, [triplets]);

  if (failed) return null;
  return <div ref={ref} className="mt-4 h-[300px] rounded-lg border bg-background/50" aria-label="connections graph" />;
}

function TripletRow({ triplet }: { triplet: QueryTriplet }) {
  return (
    <div className="rounded-md border bg-card/60 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="font-medium">{triplet.source.name}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-foreground/90">{triplet.predicate}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{triplet.target.name}</span>
      </div>
      {triplet.context ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{triplet.context}</p>
      ) : null}
    </div>
  );
}
