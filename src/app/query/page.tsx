import Link from "next/link";
import { Search } from "lucide-react";
import { askQuestion } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function QueryPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Ask the wiki</CardTitle></CardHeader>
        <CardContent>
          <form action={askQuestion} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="question">Question</Label>
              <Textarea id="question" name="question" defaultValue="what's contested about GPT-5 release date?" />
            </div>
            <Button type="submit">Synthesize and save</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Demo saved answer</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-8">Ask a question to synthesize an answer with inline source context. The demo fallback saves known GPT-5 answers immediately.</p>
          <Button asChild variant="outline"><Link href="/wiki/q/gpt5-release-date">Open saved GPT-5 release page</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
