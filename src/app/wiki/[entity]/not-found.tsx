import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EntityNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Search className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-3xl font-semibold tracking-tight">Entity not found</h1>
      <p className="max-w-md text-muted-foreground">
        This entity isn&apos;t tracked yet. Ingest a source that mentions it, or browse existing entities from the dashboard.
      </p>
      <div className="flex gap-3">
        <Button asChild><Link href="/">Back to dashboard</Link></Button>
        <Button asChild variant="outline"><Link href="/ingest">Ingest a source</Link></Button>
      </div>
    </div>
  );
}
