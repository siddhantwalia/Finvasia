import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { api, IntakeRequest, IntakeResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, RotateCcw, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

type Msg = { role: "agent" | "user"; content: string };
type Mode = null | "document" | "finder";

const uuid = () =>
  (globalThis.crypto as any)?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/* ─────────────────── Mode Selection Screen ─────────────────── */
const ModeSelect = ({ onSelect }: { onSelect: (m: Mode) => void }) => (
  <div className="container py-20 flex flex-col items-center gap-10">
    <div className="text-center space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// choose your path</div>
      <h2 className="font-display text-3xl">What would you like to do?</h2>
    </div>
    <div className="grid sm:grid-cols-2 gap-6 w-full max-w-2xl">
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onSelect("document")}
        className="quant-card p-8 flex flex-col gap-4 text-left hover:border-primary/60 transition-colors cursor-pointer"
      >
        <FileText className="h-8 w-8 text-primary" />
        <div>
          <div className="font-display text-xl mb-1">Ask about my policy</div>
          <p className="text-sm text-muted-foreground">
            Upload or link an existing insurance document. Ask specific questions — coverage, exclusions, limits, waiting periods.
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-primary mt-auto">→ document q&amp;a</div>
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onSelect("finder")}
        className="quant-card p-8 flex flex-col gap-4 text-left hover:border-primary/60 transition-colors cursor-pointer"
      >
        <Search className="h-8 w-8 text-primary" />
        <div>
          <div className="font-display text-xl mb-1">Find me a policy</div>
          <p className="text-sm text-muted-foreground">
            Tell me about yourself — age, location, budget, needs. I'll find and recommend the best policies in the current market.
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-primary mt-auto">→ policy finder</div>
      </motion.button>
    </div>
  </div>
);

/* ─────────────────── Document Q&A Mode ─────────────────── */
const DocumentChat = () => {
  const [docUrl, setDocUrl] = useState("");
  const [docReady, setDocReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep a flat chat history for memory (["User: ...", "Agent: ..."])
  const chatHistoryRef = useRef<string[]>([]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const confirmDoc = () => {
    if (!docUrl.trim()) return;
    setDocReady(true);
    chatHistoryRef.current = [];
    setMessages([{ role: "agent", content: `Got it! I've loaded your policy document. Ask me anything about it — coverage limits, exclusions, waiting periods, co-payments, or specific clauses.` }]);
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const { url } = await api.uploadPolicy(file);
      setDocUrl(url);
      setDocReady(true);
      chatHistoryRef.current = [];
      setMessages([{ role: "agent", content: `Your policy has been uploaded. Ask me anything about it.` }]);
    } catch (e: any) {
      toast.error("Upload failed", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    if (!input.trim() || loading || !docReady) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);

    // Append user message to history before sending
    chatHistoryRef.current.push(`User: ${text}`);

    try {
      const res = await api.documentChat({
        document_url: docUrl,
        question: text,
        chat_history: [...chatHistoryRef.current],
      });
      const answer = res.answer ?? "I couldn't find an answer to that in the document.";
      setMessages((m) => [...m, { role: "agent", content: answer }]);
      // Append agent response to history
      chatHistoryRef.current.push(`Agent: ${answer}`);
    } catch (e: any) {
      toast.error("Error", { description: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  if (!docReady) {
    return (
      <div className="container py-10 max-w-2xl">
        <div className="quant-card p-8 space-y-6">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// attach your policy</div>
          <div className="space-y-3">
            <label className="text-sm text-muted-foreground">Policy URL (PDF link)</label>
            <div className="flex gap-2">
              <input
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="https://…/policy.pdf"
                className="flex-1 bg-background border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary"
                onKeyDown={(e) => e.key === "Enter" && confirmDoc()}
              />
              <Button onClick={confirmDoc} disabled={!docUrl.trim()} className="rounded-none">Load</Button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[11px] text-muted-foreground">or upload a file</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <label className="block border border-dashed border-border p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
            <input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            ) : (
              <>
                <FileText className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload · PDF or DOCX</p>
              </>
            )}
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10 max-w-3xl">
      <div className="quant-card flex flex-col h-[70vh] min-h-[520px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <span>document q&amp;a · {docUrl.split("/").pop()?.slice(0, 30)}…</span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-4 py-3 border text-sm ${m.role === "user" ? "bg-primary/10 border-primary/40" : "bg-card border-border"}`}>
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-3 border bg-card border-border">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder="Ask about coverage, exclusions, waiting periods…"
              className="flex-1 resize-none bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
            />
            <Button onClick={send} disabled={loading || !input.trim()} className="rounded-none h-auto px-4">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────── Policy Finder Mode ─────────────────── */
const PolicyFinder = () => {
  const [sessionId] = useState(uuid);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "agent", content: "Hi — tell me about yourself in your own words. Age, where you live, what you're trying to insure. I'll take it from there." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
      const body: IntakeRequest = { session_id: sessionId, user_input: text, search_depth: "basic" };
      const res = await api.intake(body);
      setProfile(res.extracted_profile || {});
      if (res.intake_complete) {
        setDone(true);
        setRecommendation(res.final_recommendation || "");
        setMarket(res.market_context || []);
        setRefinedLinks(res.refined_links || []);
      }
      if (res.next_question) setMessages((m) => [...m, { role: "agent", content: res.next_question }]);
    } catch (e: any) {
      toast.error("Backend error", { description: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  const profileEntries = useMemo(
    () => Object.entries(profile).filter(([, v]) => v !== null && v !== undefined && v !== ""),
    [profile]
  );

  return (
    <div className="container py-10 grid lg:grid-cols-[1fr_360px] gap-6">
      {/* Chat */}
      <div className="quant-card flex flex-col h-[70vh] min-h-[520px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <span>session · {sessionId.slice(0, 12)}…</span>
          <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1 hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> new
          </button>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-4 py-3 border text-sm ${m.role === "user" ? "bg-primary/10 border-primary/40 text-foreground" : "bg-card border-border"}`}>
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-3 border bg-card border-border">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {/* Recommendation block */}
          {done && recommendation && (
            <div className="border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// final recommendation</div>
              <div className="text-sm prose prose-invert max-w-none">
                <ReactMarkdown>{recommendation}</ReactMarkdown>
              </div>
              {refinedLinks && refinedLinks.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// direct policy links</div>
                  {refinedLinks.map((link, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs">
                      <a href={link.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline font-medium">{link.label} <span className="text-[10px]">direct ↗</span></a>
                      <span className="text-muted-foreground">{link.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {market && market.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-border">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// market context</div>
                  <ul className="space-y-1.5">
                    {market.map((m, i) => {
                      const obj = typeof m === "string" ? { snippet: m } : m;
                      return (
                        <li key={i} className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                          {obj.title && <span className="text-foreground font-medium">{obj.title} — </span>}
                          {obj.snippet}
                          {obj.url && <a href={obj.url} target="_blank" rel="noreferrer" className="ml-1 text-primary underline-offset-4 hover:underline">↗</a>}
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
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
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
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-3">// extracted_profile</div>
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
        <div className="quant-card p-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">// status</div>
          <div className="font-mono text-xs">
            {done ? <span className="text-primary">intake_complete · true</span> : <span>gathering…</span>}
          </div>
        </div>
      </aside>
    </div>
  );
};

/* ─────────────────── Root Page ─────────────────── */
const Intake = () => {
  const [mode, setMode] = useState<Mode>(null);

  return (
    <Shell>
      <PageHeader
        index="01"
        kicker="POST /chat/intake"
        title="The agent. It asks until it understands."
        blurb="Choose between asking questions about your own policy document, or letting the agent find the best policy in the market for your profile."
      />

      {mode === null && <ModeSelect onSelect={setMode} />}

      {mode !== null && (
        <div className="container pt-4 pb-2">
          <button
            onClick={() => setMode(null)}
            className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            ← change mode
          </button>
        </div>
      )}

      {mode === "document" && <DocumentChat />}
      {mode === "finder" && <PolicyFinder />}
    </Shell>
  );
};

export default Intake;
