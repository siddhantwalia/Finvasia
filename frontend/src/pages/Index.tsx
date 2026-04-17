import { Link } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { HeroScene } from "@/components/three/HeroScene";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Cpu, Eye, GitCompareArrows, ShieldAlert, Sparkles, Workflow } from "lucide-react";
import { motion } from "framer-motion";

const tickerItems = [
  "LIVE MARKET BENCHMARK",
  "FAISS CACHE WARM",
  "GEMINI 1.5 FLASH",
  "LANGGRAPH AGENT v0.4",
  "RAG LATENCY 412ms",
  "DUCKDUCKGO SIGNAL OK",
];

const surfaces = [
  { to: "/intake", n: "01", t: "Conversational Intake", d: "An agent asks the right questions, then pitches the policy that actually fits your life — not the one with the loudest ad budget.", icon: Workflow },
  { to: "/summary", n: "02", t: "Visual Policy Summary", d: "Deductibles, copays, waiting periods. Rendered as gauges, not as 47 pages of italicised legalese.", icon: Eye },
  { to: "/compare", n: "03", t: "Semantic Comparison", d: "Two policies, side by side. We mark what's better, what's worse, and what's a marketing trick.", icon: GitCompareArrows },
  { to: "/simulate", n: "04", t: "Scenario Simulator", d: "“What if I tear my ACL skiing in Switzerland?” Get the clause, the verdict, and the bill — before it happens.", icon: Sparkles },
  { to: "/exclusions", n: "05", t: "Trap Highlighter", d: "Every policy hides something. Room rent caps, ICU sub-limits, disease-wise capping. We surface it.", icon: ShieldAlert },
  { to: "/qa", n: "06", t: "Document Q&A", d: "Ask the document anything. RAG over your PDF, cached for sub-second follow-ups.", icon: Cpu },
];

const Index = () => {
  return (
    <Shell>
      {/* Hero */}
      <section className="relative border-b border-border overflow-hidden">
        <div className="container grid lg:grid-cols-[1.1fr_1fr] gap-10 py-16 md:py-24 items-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="terminal-chip terminal-chip-live mb-5">agentic · v0.4 · live</div>
            <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-balance">
              Insurance,{" "}
              <span className="relative inline-block">
                <span className="relative z-10">decoded.</span>
                <span className="absolute inset-x-0 bottom-1 h-3 bg-primary/30 -z-0" />
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Most policy documents are written to be survived, not read. The Insurance Intelligence Engine
              transforms them into something a human can actually trust — interactive summaries, scenario
              simulations, and market-aware recommendations.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-none font-mono uppercase tracking-widest text-xs">
                <Link to="/intake">start the agent <ArrowUpRight className="ml-1.5 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-none font-mono uppercase tracking-widest text-xs">
                <Link to="/summary">visual summary demo</Link>
              </Button>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-6 max-w-md">
              {[
                { k: "RAG", v: "FAISS + Gemini" },
                { k: "Agent", v: "LangGraph" },
                { k: "Signal", v: "DuckDuckGo" },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{s.k}</dt>
                  <dd className="font-mono text-sm mt-1">{s.v}</dd>
                </div>
              ))}
            </dl>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="relative aspect-square max-h-[560px] quant-card overflow-hidden"
          >
            <div className="absolute inset-0 scanline pointer-events-none z-10" />
            <div className="absolute top-3 left-3 z-10 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              ./scene/policy-shards.glb
            </div>
            <div className="absolute bottom-3 right-3 z-10 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              fps · 60
            </div>
            <HeroScene />
          </motion.div>
        </div>

        {/* Ticker */}
        <div className="border-t border-border bg-card/50 overflow-hidden">
          <div className="flex animate-ticker py-3 whitespace-nowrap font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {[...tickerItems, ...tickerItems, ...tickerItems].map((t, i) => (
              <span key={i} className="mx-6 flex items-center gap-3">
                <span className="text-primary">▮</span>
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Surfaces grid */}
      <section className="container py-20">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">// the six surfaces</div>
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
              One backend. Six ways to look at your policy.
            </h2>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Each module is wired to a single FastAPI endpoint. Modular by design — drop one in, leave the rest.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
          {surfaces.map((s, i) => (
            <Link
              to={s.to}
              key={s.to}
              className="group bg-card p-6 hover:bg-secondary/40 transition-colors relative animate-fade-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{s.n}</span>
                <s.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h3 className="font-display text-xl font-semibold mb-2">{s.t}</h3>
              <p className="text-sm text-muted-foreground">{s.d}</p>
              <div className="mt-5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground group-hover:text-primary inline-flex items-center gap-1.5">
                open <ArrowUpRight className="h-3 w-3" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Manifesto */}
      <section className="border-y border-border bg-card/40">
        <div className="container py-20 grid lg:grid-cols-[1fr_2fr] gap-10">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            // a small manifesto
          </div>
          <div>
            <p className="font-display text-2xl md:text-3xl leading-relaxed text-balance">
              We don't think you should need a lawyer to understand whether your hospital bill is covered.
              We don't think the most important number in your life should be hidden in
              <span className="text-primary"> footnote 14, sub-clause (c)(ii)</span>. So we built a tool that
              reads the document for you — fairly, fully, and out loud.
            </p>
            <p className="mt-6 text-muted-foreground max-w-2xl">
              Built by a small team that's filed too many claims. Powered by a stack we actually trust.
              Open about its limits.
            </p>
          </div>
        </div>
      </section>
    </Shell>
  );
};

export default Index;
