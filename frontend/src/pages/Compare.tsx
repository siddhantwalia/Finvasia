import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { api, CompareResponse, ComparisonRow, StatusColor } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

const dot = (s: StatusColor) => {
  const map: Record<StatusColor, string> = {
    green: "bg-success",
    red: "bg-destructive",
    yellow: "bg-warning",
    gray: "bg-muted-foreground",
  };
  return <span className={`inline-block h-2 w-2 ${map[s] ?? "bg-muted-foreground"}`} aria-hidden />;
};

const Section = ({ title, rows }: { title: string; rows: ComparisonRow[] }) => (
  <div className="quant-card overflow-hidden">
    <div className="border-b border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      // {title}
    </div>
    {rows.length === 0 ? (
      <div className="p-6 font-mono text-xs text-muted-foreground">no rows.</div>
    ) : (
      <div className="grid grid-cols-[1.3fr_1fr_1fr]">
        <div className="contents font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <div className="px-4 py-2 border-b border-border">feature</div>
          <div className="px-4 py-2 border-b border-l border-border">policy A</div>
          <div className="px-4 py-2 border-b border-l border-border">policy B</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="contents text-sm">
            <div className="px-4 py-3 border-b border-border font-medium">{r.feature}</div>
            <div className="px-4 py-3 border-b border-l border-border flex items-center gap-2">{dot(r.old_status)} {r.old_val}</div>
            <div className="px-4 py-3 border-b border-l border-border flex items-center gap-2">{dot(r.new_status)} {r.new_val}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const Compare = () => {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompareResponse | null>(null);

  const run = async () => {
    if (!a.trim() || !b.trim()) return;
    setLoading(true);
    try { setData(await api.compare({ old_policy: a.trim(), new_policy: b.trim() })); }
    catch (e: any) { toast.error("Compare failed", { description: e?.message }); }
    finally { setLoading(false); }
  };

  return (
    <Shell>
      <PageHeader
        index="03"
        kicker="POST /compare_policies"
        title="Two policies. One verdict."
        blurb="Drop in the URLs (or raw text) of any two policies — or pit one against a market baseline. We line them up feature by feature and tell you who wins."
      />

      <div className="container py-10 grid gap-6">
        <div className="grid md:grid-cols-2 gap-4">
          {[{ v: a, set: setA, label: "policy A · old / current" }, { v: b, set: setB, label: "policy B · new / proposed" }].map((f, i) => (
            <div key={i} className="quant-card p-4">
              <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// {f.label}</label>
              <textarea
                value={f.v}
                onChange={(e) => f.set(e.target.value)}
                rows={3}
                placeholder="https://…/policy.pdf or paste text"
                className="w-full mt-2 bg-background border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary resize-none"
              />
            </div>
          ))}
        </div>
        <div>
          <Button onClick={run} disabled={loading || !a.trim() || !b.trim()} className="rounded-none font-mono uppercase tracking-widest text-xs">
            {loading ? "comparing…" : "run comparison"}
          </Button>
        </div>

        {data && (
          <>
            <div className="quant-card p-5 bg-secondary/40">
              <div className="font-mono text-[11px] uppercase tracking-widest text-primary mb-2">// scenario_summary</div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{data.scenario_summary}</ReactMarkdown>
              </div>
            </div>
            <Section title="financial_comparison" rows={data.financial_comparison} />
            <Section title="coverage_comparison" rows={data.coverage_comparison} />
            <Section title="exclusions_comparison" rows={data.exclusions_comparison} />
          </>
        )}
      </div>
    </Shell>
  );
};

export default Compare;
