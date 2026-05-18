"use client";

import { useFormStatus } from "react-dom";
import { FileText, Loader2, UploadCloud } from "lucide-react";
import { ingestSource } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function IngestForm() {
  return (
    <form action={ingestSource} className="grid gap-4 sm:grid-cols-[2fr_1fr]">
      <div className="space-y-2">
        <Label htmlFor="url">Article URL</Label>
        <Input id="url" name="url" type="url" placeholder="https://example.com/ai-news/story" required autoComplete="off" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pdf">PDF upload</Label>
        <Input id="pdf" name="pdf" type="file" accept="application/pdf" />
      </div>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground sm:col-span-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0" />
        Text PDFs supported in v1. Scanned PDFs without embedded text need OCR and remain a stretch item.
      </p>
      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-w-[12rem]">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Queuing…
        </>
      ) : (
        <>
          <UploadCloud className="h-4 w-4" /> Queue ingest
        </>
      )}
    </Button>
  );
}
