"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Sparkles } from "lucide-react";
import { askQuestion } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function QueryForm() {
  return (
    <form action={askQuestion} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="question">Question</Label>
        <Textarea
          id="question"
          name="question"
          defaultValue="What is contested about GPT-5 release timing?"
          rows={4}
        />
      </div>
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-w-[10rem]">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" /> Ask
        </>
      )}
    </Button>
  );
}
