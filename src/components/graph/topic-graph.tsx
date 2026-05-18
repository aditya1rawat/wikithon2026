"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { GraphData } from "@/lib/types";

const TYPE_COLORS: Record<string, string> = {
  MODEL: "#1554a5",
  ORG: "#7e5bef",
  PERSON: "#0f9b6e",
  PRODUCT: "#c4651a",
  EVENT: "#b03a8a",
  SOURCE: "#94a3b8",
};

const LEGEND: { type: string; label: string }[] = [
  { type: "MODEL", label: "Model" },
  { type: "ORG", label: "Org" },
  { type: "PERSON", label: "Person" },
  { type: "PRODUCT", label: "Product" },
  { type: "EVENT", label: "Event" },
  { type: "SOURCE", label: "Source" },
];

export function TopicGraph({ data }: { data: GraphData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let cy: cytoscape.Core | null = null;
    try {
      cy = cytoscape({
        container,
        elements: [
          ...data.nodes.map((node) => ({
            data: {
              id: node.id,
              label: node.label,
              type: node.type,
              color: TYPE_COLORS[node.type] ?? "#1554a5",
              size: 28 + Math.min(((node.claimCount ?? 0) * 4), 28),
            },
          })),
          ...data.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, relation: edge.relation } })),
        ],
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "background-color": "data(color)",
              "border-width": 2,
              "border-color": "#ffffff",
              color: "#0b1726",
              "font-size": 12,
              "font-weight": 500,
              width: "data(size)",
              height: "data(size)",
              "text-valign": "bottom",
              "text-margin-y": 8,
              "text-outline-width": 2,
              "text-outline-color": "#f6f8fb",
            },
          },
          { selector: 'node[type = "SOURCE"]', style: { shape: "round-rectangle", "background-opacity": 0.7 } },
          {
            selector: "edge",
            style: {
              label: "data(label)",
              width: 2,
              "line-color": "#94a3b8",
              "target-arrow-shape": "triangle",
              "target-arrow-color": "#94a3b8",
              "curve-style": "bezier",
              "font-size": 10,
              color: "#4b5868",
              opacity: 0.85,
            },
          },
          { selector: 'edge[relation = "mentions"]', style: { "line-style": "dashed", "line-color": "#cbd5e1", "target-arrow-color": "#cbd5e1", opacity: 0.6 } },
          { selector: 'edge[relation = "contradict"]', style: { "line-color": "#d11b1b", "target-arrow-color": "#d11b1b", width: 3 } },
          { selector: 'edge[relation = "agree"]', style: { "line-color": "#128e5e", "target-arrow-color": "#128e5e" } },
          { selector: 'edge[relation = "qualify"]', style: { "line-color": "#c47900", "target-arrow-color": "#c47900" } },
          { selector: "node:active", style: { "overlay-color": "#1554a5", "overlay-opacity": 0.15 } },
        ],
        layout: { name: "concentric", animate: false, padding: 30, minNodeSpacing: 30 },
      });
      // Re-fit after a tick in case the container started at 0 size (strict-mode mount race).
      requestAnimationFrame(() => {
        try {
          cy?.resize();
          cy?.fit(undefined, 30);
        } catch {
          // ignore
        }
      });
    } catch (error) {
      console.error("[topic-graph] cytoscape init failed:", error);
      queueMicrotask(() => setFailed(true));
    }
    return () => {
      cy?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nodes.length, data.edges.length]);

  if (failed) return <p className="text-sm text-muted-foreground">Graph renderer unavailable. Table fallback shown below.</p>;
  return (
    <div className="space-y-3">
      <div ref={ref} className="h-[560px] rounded-xl border bg-card shadow-sm" aria-label="topic graph" />
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card/70 px-3 py-2 text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">Legend</span>
        {LEGEND.map((item) => (
          <span key={item.type} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: TYPE_COLORS[item.type] }} />
            {item.label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-500" /> agree</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-destructive" /> contradict</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-amber-500" /> qualify</span>
        </span>
      </div>
    </div>
  );
}
