import { getGraphData } from "@/lib/app-service";
import { TopicGraph } from "@/components/graph/topic-graph";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function GraphPage() {
  const data = await getGraphData();
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Topic graph</h1>
        <p className="mt-2 text-muted-foreground">HydraDB graph context becomes entity nodes and relation edges. Red edges mark disputes.</p>
      </section>
      <TopicGraph data={data} />
      <Card>
        <CardHeader><CardTitle>Edges fallback</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Target</TableHead><TableHead>Relation</TableHead><TableHead>Rationale</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.edges.map((edge) => (
                <TableRow key={edge.id}>
                  <TableCell>{data.nodes.find((node) => node.id === edge.source)?.label}</TableCell>
                  <TableCell>{data.nodes.find((node) => node.id === edge.target)?.label}</TableCell>
                  <TableCell><Badge variant={edge.relation === "contradict" ? "destructive" : "secondary"}>{edge.relation}</Badge></TableCell>
                  <TableCell>{edge.rationale}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
