import { useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { PolicyUrlInput } from "@/components/PolicyUrlInput";
import { api, ExclusionItem } from "@/lib/api";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const ratingStyles = (r: string) => {
  switch (r?.toLowerCase()) {
    case "high": return "border-destructive text-destructive";
    case "medium": return "border-warning text-warning";
    case "low": return "border-success text-success";
    default: return "border-muted-foreground text-muted-foreground";
  }
};

const Exclusions = () => {
  const [items, setItems] = useState<ExclusionItem[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async (u: string) => {
    setLoading(true);
    try { setItems(await api.exclusions({ policy_url: u })); }
    catch (e: any) { toast.error("Failed", { description: e?.message }); }
    finally { setLoading(false); }
  };

  const grouped = {
    high: items.filter((i) => i.trap_rating?.toLowerCase() === "high"),
    medium: items.filter((i) => i.trap_rating?.toLowerCase() === "medium"),
    low: items.filter((i) => i.trap_rating?.toLowerCase() === "low"),
    other: items.filter((i) => !["high", "medium", "low"].includes(i.trap_rating?.toLowerCase?.() ?? "")),
  };

  return (
    <Shell>
      <PageHeader
        index="05"
        kicker="POST /get_exclusions"
        title="Every policy hides something."
        blurb="Room rent caps. ICU sub-limits. Disease-wise capping. Co-payment after age 60. The little clauses that quietly shift the bill back to you."
      />

      <div className="container py-10 grid gap-6">
        <PolicyUrlInput onSubmit={run} loading={loading} cta="surface traps" />

        {items.length > 0 && (
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { k: "high", c: grouped.high.length, l: "high-risk traps" },
              { k: "medium", c: grouped.medium.length, l: "medium" },
              { k: "low", c: grouped.low.length, l: "low" },
            ].map((s) => (
              <div key={s.k} className="quant-card p-5">
                <div className={`font-mono text-[11px] uppercase tracking-widest border-b pb-2 ${ratingStyles(s.k)}`}>// {s.l}</div>
                <div className="font-display text-4xl mt-3">{s.c}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3">
          {items.length === 0 ? (
            <div className="quant-card p-8 text-center font-mono text-xs text-muted-foreground">
              {loading ? "scanning the document…" : "drop a policy URL above to surface hidden limitations."}
            </div>
          ) : (
            items.map((it, i) => (
              <div key={i} className="quant-card p-5 grid grid-cols-[auto_1fr_auto] gap-4 items-start">
                <AlertTriangle className={`h-5 w-5 mt-0.5 ${it.trap_rating?.toLowerCase() === "high" ? "text-destructive" : it.trap_rating?.toLowerCase() === "medium" ? "text-warning" : "text-muted-foreground"}`} />
                <div>
                  <div className="font-display text-lg">{it.feature}</div>
                  <p className="text-sm text-muted-foreground mt-1">{it.description}</p>
                </div>
                <span className={`font-mono text-[10px] uppercase tracking-widest border px-2 py-1 ${ratingStyles(it.trap_rating)}`}>
                  {it.trap_rating}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Shell>
  );
};

export default Exclusions;
