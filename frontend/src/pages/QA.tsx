import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, X, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

const QA = () => {
  const [doc, setDoc] = useState("");
  const [questions, setQuestions] = useState<string[]>(["Is maternity covered?"]);
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);

  const update = (i: number, v: string) => setQuestions((q) => q.map((x, idx) => (idx === i ? v : x)));
  const add = () => setQuestions((q) => [...q, ""]);
  const remove = (i: number) => setQuestions((q) => q.filter((_, idx) => idx !== i));

  const run = async () => {
    const qs = questions.map((q) => q.trim()).filter(Boolean);
    if (!doc.trim() || qs.length === 0) return;
    setLoading(true); setAnswers([]);
    try {
      const res = await api.hackrx({ documents: doc.trim(), questions: qs });
      const a = (res.answers as string[] | undefined) ?? Object.values(res).flat() as any;
      setAnswers(Array.isArray(a) ? a : []);
    } catch (e: any) { toast.error("Q&A failed", { description: e?.message }); }
    finally { setLoading(false); }
  };

  return (
    <Shell>
      <PageHeader
        index="06"
        kicker="POST /hackrx/run"
        title="Ask the document anything."
        blurb="Direct retrieval-augmented Q&A. Cached vector indices keep follow-ups under a second."
      />

      <div className="container py-10 grid gap-6">
        <div className="quant-card p-5">
          <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// documents</label>
          <textarea
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            rows={2}
            placeholder="https://…/policy.pdf or paste raw text"
            className="w-full mt-2 bg-background border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <div className="quant-card p-5 grid gap-3">
          <div className="flex justify-between items-center">
            <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// questions</label>
            <button onClick={add} className="font-mono text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
              <Plus className="h-3 w-3" /> add
            </button>
          </div>
          {questions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={q}
                onChange={(e) => update(i, e.target.value)}
                placeholder={`question ${i + 1}`}
                className="flex-1 bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              {questions.length > 1 && (
                <button onClick={() => remove(i)} className="h-9 w-9 grid place-items-center border border-border text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <div>
            <Button onClick={run} disabled={loading || !doc.trim()} className="rounded-none font-mono uppercase tracking-widest text-xs">
              {loading ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> running rag…</> : "ask"}
            </Button>
          </div>
        </div>

        {answers.length > 0 && (
          <div className="grid gap-3">
            {answers.map((a, i) => (
              <div key={i} className="quant-card p-5">
                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
                  // answer · {String(i + 1).padStart(2, "0")}
                </div>
                <div className="font-mono text-[11px] text-primary mb-2">Q: {questions[i]}</div>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{a}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
};

export default QA;
