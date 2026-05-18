import { getGraphData } from "@/lib/app-service";
import { TopicGraph } from "@/components/graph/topic-graph";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { GraphEdge } from "@/lib/types";

const RELATION_RANK: Record<string, number> = { contradict: 0, qualify: 1, agree: 2, mentions: 3, cites: 3 };

export default async function GraphPage() {
  const data = await getGraphData();
  const sortedEdges = [...data.edges].sort(
    (a, b) => (RELATION_RANK[a.relation] ?? 4) - (RELATION_RANK[b.relation] ?? 4),
  );
  const primaryEdges = sortedEdges.filter((edge) => edge.relation !== "mentions" && edge.relation !== "cites");
  const mentionEdges = sortedEdges.filter((edge) => edge.relation === "mentions" || edge.relation === "cites");
  const nodeLabel = (id: string) => data.nodes.find((node) => node.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Topic graph</h1>
        <p className="mt-2 text-muted-foreground">HydraDB graph context becomes entity nodes and relation edges. Red edges mark disputes.</p>
      </section>
      <TopicGraph data={data} />
      <Card>
        <CardHeader>
          <CardTitle>Edges</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm leading-6 text-muted-foreground">
            Sorted by relation impact: contradict, qualify, agree. Source mentions are collapsed below.
          </p>
          <Table>
            <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Target</TableHead><TableHead>Relation</TableHead><TableHead>Rationale</TableHead></TableRow></TableHeader>
            <TableBody>
              {primaryEdges.length ? (
                primaryEdges.map((edge) => <EdgeRow key={edge.id} edge={edge} sourceLabel={nodeLabel(edge.source)} targetLabel={nodeLabel(edge.target)} />)
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">No agree/contradict/qualify edges yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {mentionEdges.length ? (
            <details className="mt-4 rounded-md border bg-card/70">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground hover:text-primary">
                Show {mentionEdges.length} source-mention edges
              </summary>
              <div className="px-3 pb-3">
                <Table>
                  <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Target</TableHead><TableHead>Relation</TableHead><TableHead>Rationale</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {mentionEdges.map((edge) => <EdgeRow key={edge.id} edge={edge} sourceLabel={nodeLabel(edge.source)} targetLabel={nodeLabel(edge.target)} />)}
                  </TableBody>
                </Table>
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function EdgeRow({ edge, sourceLabel, targetLabel }: { edge: GraphEdge; sourceLabel: string; targetLabel: string }) {
  return (
    <TableRow>
      <TableCell className="max-w-[20rem] truncate" title={sourceLabel}>{sourceLabel}</TableCell>
      <TableCell className="max-w-[16rem] truncate" title={targetLabel}>{targetLabel}</TableCell>
      <TableCell>
        <Badge variant={edge.relation === "contradict" ? "destructive" : "secondary"}>{edge.relation}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{edge.rationale ?? "No rationale stored."}</TableCell>
    </TableRow>
  );
}
