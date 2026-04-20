import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { api, IntakeRequest, IntakeResponse, SearchDepth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type Msg = { role: "agent" | "user"; content: string };

const uuid = () =>
  (globalThis.crypto as any)?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const Intake = () => {
  const [sessionId] = useState(uuid);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "agent", content: "Hi — tell me about yourself in your own words. Age, where you live, what you're trying to insure. I'll take it from there." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [depth, setDepth] = useState<SearchDepth>("basic");
  const [docUrl, setDocUrl] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);
  const [recommendation, setRecommendation] = useState("");
  const [market, setMarket] = useState<IntakeResponse["market_context"]>([]);
  const [refinedLinks, setRefinedLinks] = useState<IntakeResponse["refined_links"]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const body: IntakeRequest = {
        session_id: sessionId,
        user_input: text,
        search_depth: depth,
        documents: docUrl || undefined,
      };
      const res = await api.intake(body);
      setProfile(res.extracted_profile || {});
      if (res.intake_complete) {
        setDone(true);
        setRecommendation(res.final_recommendation || "");
        setMarket(res.market_context || []);
        setRefinedLinks(res.refined_links || []);
        if (res.next_question) setMessages((m) => [...m, { role: "agent", content: res.next_question }]);
      } else {
        setMessages((m) => [...m, { role: "agent", content: res.next_question || "(no question returned)" }]);
      }
    } catch (e: any) {
      toast.error("Backend error", { description: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => window.location.reload();

  const profileEntries = useMemo(
    () => Object.entries(profile).filter(([, v]) => v !== null && v !== undefined && v !== ""),
    [profile]
  );

  return (
    <Shell>
      <PageHeader
        index="01"
        kicker="POST /chat/intake"
        title="The agent. It asks until it understands."
        blurb="Conversational intake powered by LangGraph. Each turn updates the structured profile on the right. When complete, it pitches the best policy — internal catalogue plus live market signal."
      />

      <div className="container py-10 grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Chat */}
        <div className="quant-card flex flex-col h-[70vh] min-h-[520px]">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>session · {sessionId.slice(0, 12)}…</span>
            <button onClick={reset} className="inline-flex items-center gap-1 hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> new
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] px-4 py-3 border ${
                    m.role === "user"
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-card border-border"
                  }`}
                >
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                    {m.role === "user" ? "you" : "agent"}
                  </div>
                  <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> thinking…
              </div>
            )}
            {done && recommendation && (
              <div className="quant-card p-5 mt-2 bg-secondary/40">
                <div className="font-mono text-[11px] uppercase tracking-widest text-primary mb-2">
                  // final recommendation
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{recommendation}</ReactMarkdown>
                </div>
                {refinedLinks && refinedLinks.length > 0 && (
                  <div className="mt-4 grid gap-3">
                    <div className="font-mono text-[11px] uppercase tracking-widest text-primary">
                      // direct policy links
                    </div>
                    <div className="grid gap-2">
                      {refinedLinks.map((link, i) => (
                        <a
                          key={i}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group block p-3 border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all no-underline"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-sm font-semibold text-primary group-hover:underline underline-offset-4">{link.label}</span>
                            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">direct ↗</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{link.reason}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {market?.length > 0 && (
                  <div className="mt-6 grid gap-2">
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      // market context
                    </div>
                    <ul className="space-y-1.5">
                      {market.map((m, i) => {
                        const obj = typeof m === "string" ? { snippet: m } : m;
                        return (
                          <li key={i} className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                            {obj.title && <span className="text-foreground font-medium">{obj.title} — </span>}
                            {obj.snippet}
                            {obj.url && (
                              <a href={obj.url} target="_blank" rel="noreferrer" className="ml-1 text-primary underline-offset-4 hover:underline">↗</a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                rows={2}
                placeholder="type your reply… (enter to send, shift+enter for newline)"
                className="flex-1 resize-none bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
              />
              <Button onClick={send} disabled={loading || !input.trim()} className="rounded-none h-auto px-4">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Sidecar */}
        <aside className="space-y-4">
          <div className="quant-card p-4">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
              // extracted_profile
            </div>
            {profileEntries.length === 0 ? (
              <div className="font-mono text-xs text-muted-foreground">{"{ /* still listening */ }"}</div>
            ) : (
              <dl className="grid gap-2">
                {profileEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
                    <dt className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-xs text-right text-foreground break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="quant-card p-4 space-y-3">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// search_depth</div>
            <div className="grid grid-cols-2 gap-px bg-border border border-border">
              {(["basic", "deep"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`py-2 font-mono text-[11px] uppercase tracking-widest ${
                    depth === d ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="quant-card p-4 space-y-2">
            <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// documents (optional)</label>
            <input
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="https://…/policy.pdf"
              className="w-full bg-background border border-border px-2 py-2 text-xs font-mono focus:outline-none focus:border-primary"
            />
            <p className="text-[11px] text-muted-foreground">attach an existing policy to ground recommendations.</p>
          </div>

          <div className="quant-card p-4">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">// status</div>
            <div className="font-mono text-xs">
              {done ? <span className="text-primary">intake_complete · true</span> : <span>gathering…</span>}
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  );
};

export default Intake;
