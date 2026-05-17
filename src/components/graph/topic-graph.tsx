"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { GraphData } from "@/lib/types";

export function TopicGraph({ data }: { data: GraphData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    try {
      const cy = cytoscape({
        container: ref.current,
        elements: [
          ...data.nodes.map((node) => ({ data: { id: node.id, label: node.label } })),
          ...data.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, relation: edge.relation } })),
        ],
        style: [
          { selector: "node", style: { label: "data(label)", "background-color": "#1667b7", color: "#122033", "font-size": 12, "text-valign": "bottom", "text-margin-y": 8 } },
          { selector: "edge", style: { label: "data(label)", width: 2, "line-color": "#7b8794", "target-arrow-shape": "triangle", "target-arrow-color": "#7b8794", "curve-style": "bezier", "font-size": 10 } },
          { selector: 'edge[relation = "contradict"]', style: { "line-color": "#dc2626", "target-arrow-color": "#dc2626" } },
          { selector: 'edge[relation = "agree"]', style: { "line-color": "#059669", "target-arrow-color": "#059669" } },
        ],
        layout: { name: "circle" },
      });
      return () => cy.destroy();
    } catch {
      queueMicrotask(() => setFailed(true));
    }
  }, [data]);

  if (failed) return <p className="text-sm text-muted-foreground">Graph renderer unavailable. Table fallback shown below.</p>;
  return <div ref={ref} className="h-[520px] rounded-lg border bg-card" aria-label="topic graph" />;
}
