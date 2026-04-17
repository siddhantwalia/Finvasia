import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { PolicyUrlInput } from "@/components/PolicyUrlInput";
import { api, ScenarioResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

const PRESETS = [
  "I get into an accident while skiing in Switzerland. Is my air-lift covered?",
  "Hospitalised for 3 nights for dengue in Mumbai. What do I pay?",
  "Maternity delivery in month 10 of policy — covered or not?",
  "Outpatient mental health therapy, 12 sessions a year.",
];

const Simulate = () => {
  const [policy, setPolicy] = useState("");
  const [scenario, setScenario] = useState("");
  const [age, setAge] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ScenarioResponse | null>(null);

  const run = async () => {
    if (!policy.trim() || !scenario.trim()) return;
    setLoading(true);
    try {
      const data = await api.simulate({
        policy_url: policy.trim(),
        scenario: scenario.trim(),
        user_profile: age ? { age: Number(age) } : {},
      });
      setRes(data);
    } catch (e: any) {
      toast.error("Simulation failed", { description: e?.message });
    } finally { setLoading(false); }
  };

  return (
    <Shell>
      <PageHeader
        index="04"
        kicker="POST /simulate_scenario"
        title="What if…?"
        blurb="Put your policy through a real-world test. The agent finds the relevant clause, adjudicates coverage, and estimates what comes out of your pocket."
      />

      <div className="container py-10 grid gap-6">
        <PolicyUrlInput onSubmit={(u) => setPolicy(u)} cta="set policy" defaultValue={policy} />

        <div className="quant-card p-5 grid gap-4">
          <div>
            <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// scenario</label>
            <textarea
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              rows={3}
              placeholder="describe the situation in plain language…"
              className="w-full mt-2 bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => setScenario(p)}
                className="font-mono text-[11px] px-2 py-1 border border-border bg-card hover:border-primary hover:text-primary transition-colors text-left"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-[140px_1fr_auto] gap-3 items-end">
            <div>
              <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// age</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="30"
                className="w-full mt-2 bg-background border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary"
              />
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">policy: {policy ? `${policy.slice(0, 60)}${policy.length > 60 ? "…" : ""}` : "(not set)"}</div>
            <Button onClick={run} disabled={loading || !policy || !scenario} className="rounded-none font-mono uppercase tracking-widest text-xs">
              {loading ? "adjudicating…" : "simulate"}
            </Button>
          </div>
        </div>

        {res && (
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
            <div className={`quant-card p-6 flex flex-col items-start ${res.is_covered ? "shadow-glow" : ""}`}>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// verdict</div>
              <div className="mt-3 flex items-center gap-3">
                <div className={`h-12 w-12 grid place-items-center border ${res.is_covered ? "bg-primary text-primary-foreground border-primary" : "bg-destructive text-destructive-foreground border-destructive"}`}>
                  {res.is_covered ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
                </div>
                <div>
                  <div className="font-display text-2xl">{res.status}</div>
                  <div className="font-mono text-xs text-muted-foreground">is_covered · {String(res.is_covered)}</div>
                </div>
              </div>
              <div className="mt-6 w-full">
                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// estimated out-of-pocket</div>
                <div className="font-display text-3xl mt-1">{res.estimated_out_of_pocket}</div>
              </div>
            </div>
            <div className="grid gap-4">
              <div className="quant-card p-5">
                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">// explanation</div>
                <p className="text-sm leading-relaxed">{res.explanation}</p>
              </div>
              <div className="quant-card p-5">
                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">// relevant_clause</div>
                <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground border-l-2 border-primary pl-3">{res.relevant_clause}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
};

export default Simulate;
