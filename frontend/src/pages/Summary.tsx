import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { PolicyUrlInput } from "@/components/PolicyUrlInput";
import { CoverageOrb } from "@/components/three/CoverageOrb";
import { api, VisualSummary } from "@/lib/api";
import { toast } from "sonner";
import { motion } from "framer-motion";

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="quant-card p-5">
    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className="font-display text-3xl mt-2">{value}</div>
    {sub && <div className="font-mono text-xs text-muted-foreground mt-1">{sub}</div>}
  </div>
);

const Bar = ({ pct, label, value }: { pct: number; label: string; value: string }) => (
  <div>
    <div className="flex justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
    <div className="h-2 bg-secondary border border-border overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, pct * 100)}%` }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className="h-full bg-gradient-signal"
      />
    </div>
  </div>
);

const Summary = () => {
  const [data, setData] = useState<VisualSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");

  const run = async (u: string) => {
    setLoading(true); setUrl(u);
    try { setData(await api.visualSummary({ policy_url: u })); }
    catch (e: any) { toast.error("Failed", { description: e?.message }); }
    finally { setLoading(false); }
  };

  // derive a 0-1 coverage score for the orb
  const score = data
    ? Math.max(0.15, Math.min(0.95, 1 - Math.min(1, (data.deductible?.individual ?? 0) / 5000) * 0.4 - Math.min(1, (data.max_out_of_pocket ?? 0) / 15000) * 0.3))
    : 0.6;

  return (
    <Shell>
      <PageHeader
        index="02"
        kicker="POST /get_visual_summary"
        title="Your policy. Now legible."
        blurb="Structured fields extracted from the document — gauges instead of paragraphs, numbers instead of footnotes."
      />

      <div className="container py-10 grid gap-6">
        <PolicyUrlInput onSubmit={run} loading={loading} cta="extract" />

        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
          {/* 3D + score */}
          <div className="quant-card relative aspect-square min-h-[360px] overflow-hidden">
            <div className="absolute top-3 left-3 z-10 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              ./coverage_orb · score {(score * 100).toFixed(0)}
            </div>
            <CoverageOrb score={score} />
            <div className="absolute bottom-4 left-4 right-4 z-10">
              <div className="font-display text-4xl">{(score * 100).toFixed(0)}<span className="text-muted-foreground text-2xl">/100</span></div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mt-1">composite coverage index</div>
            </div>
          </div>

          {/* Numbers */}
          <div className="grid sm:grid-cols-2 gap-4 content-start">
            <Stat label="deductible · individual" value={data ? `$${data.deductible.individual.toLocaleString()}` : "—"} />
            <Stat label="deductible · family" value={data ? `$${data.deductible.family.toLocaleString()}` : "—"} />
            <Stat label="max out-of-pocket" value={data ? `$${data.max_out_of_pocket.toLocaleString()}` : "—"} />
            <Stat label="coinsurance" value={data?.coinsurance ?? "—"} />
            <Stat label="copay · pcp" value={data?.copay.pcp ?? "—"} />
            <Stat label="copay · specialist" value={data?.copay.specialist ?? "—"} sub={data ? `er · ${data.copay.er}` : undefined} />
          </div>
        </div>

        {/* waiting periods */}
        <div className="quant-card p-6">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-4">// waiting_periods</div>
          {data?.waiting_periods?.length ? (
            <div className="grid gap-4">
              {data.waiting_periods.map((w, i) => {
                // crude: parse months from "24 months"
                const m = parseInt(w.period.match(/\d+/)?.[0] ?? "0", 10);
                const pct = Math.min(1, m / 48);
                return <Bar key={i} label={w.condition} value={w.period} pct={pct} />;
              })}
            </div>
          ) : (
            <div className="font-mono text-xs text-muted-foreground">{loading ? "fetching…" : "run an extraction to populate."}</div>
          )}
        </div>

        {/* highlights */}
        <div className="quant-card p-6">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-4">// highlights</div>
          {data?.highlights?.length ? (
            <ul className="grid sm:grid-cols-2 gap-3">
              {data.highlights.map((h, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-primary font-mono mt-0.5">▸</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="font-mono text-xs text-muted-foreground">no highlights yet.</div>
          )}
        </div>

        {url && <div className="font-mono text-[11px] text-muted-foreground">source · {url}</div>}
      </div>
    </Shell>
  );
};

export default Summary;
