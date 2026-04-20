import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { PolicyUrlInput } from "@/components/PolicyUrlInput";
import { api, VisualSummary } from "@/lib/api";
import { toast } from "sonner";
import { motion } from "framer-motion";

const BenefitCard = ({ label, value }: { label: string; value: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className="quant-card p-5 flex flex-col gap-2"
  >
    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground leading-tight">
      {label}
    </div>
    <div className="font-display text-2xl break-words leading-snug">{value}</div>
  </motion.div>
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

  return (
    <Shell>
      <PageHeader
        index="02"
        kicker="POST /get_visual_summary"
        title="Your policy. Now legible."
        blurb="Every benefit and limit extracted directly from the document — in the policy's own words, not generic labels."
      />

      <div className="container py-10 grid gap-6">
        <PolicyUrlInput onSubmit={run} loading={loading} cta="extract" />

        {/* Benefits Grid */}
        {(data?.benefits?.length ?? 0) > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data!.benefits.map((b, i) => (
              <BenefitCard key={i} label={b.label} value={b.value} />
            ))}
          </div>
        ) : (
          <div className="quant-card p-8 text-center">
            <div className="font-mono text-xs text-muted-foreground">
              {loading ? "extracting policy data…" : "paste a policy URL above to extract coverage details."}
            </div>
          </div>
        )}

        {/* Waiting periods */}
        {(data?.waiting_periods?.length ?? 0) > 0 && (
          <div className="quant-card p-6">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-4">// waiting_periods</div>
            <div className="grid gap-4">
              {data!.waiting_periods.map((w, i) => {
                const m = parseInt(w.period.match(/\d+/)?.[0] ?? "0", 10);
                const pct = Math.min(1, m / 48);
                return <Bar key={i} label={w.condition} value={w.period} pct={pct} />;
              })}
            </div>
          </div>
        )}

        {/* Highlights */}
        {(data?.highlights?.length ?? 0) > 0 && (
          <div className="quant-card p-6">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-4">// highlights</div>
            <ul className="grid sm:grid-cols-2 gap-3">
              {data!.highlights.map((h, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-primary font-mono mt-0.5">▸</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {url && <div className="font-mono text-[11px] text-muted-foreground">source · {url}</div>}
      </div>
    </Shell>
  );
};

export default Summary;
