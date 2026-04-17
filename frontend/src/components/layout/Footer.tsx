import { useEffect, useState } from "react";
import { getApiBase, setApiBase } from "@/lib/api";

export const Footer = () => {
  const [base, setBase] = useState(getApiBase());
  const [editing, setEditing] = useState(false);
  useEffect(() => setBase(getApiBase()), []);

  return (
    <footer className="border-t border-border mt-24">
      <div className="container py-10 grid gap-6 md:grid-cols-3 text-sm">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">// the engine</div>
          <p className="text-muted-foreground max-w-sm">
            Built by humans who got tired of reading 80-page policy PDFs at midnight. We turn fine print into
            something you can actually look at.
          </p>
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">// stack</div>
          <ul className="space-y-1 font-mono text-xs">
            <li>LangGraph · FAISS · Gemini 1.5 Flash</li>
            <li>DuckDuckGo market signal</li>
            <li>RAG with cached vector indices</li>
          </ul>
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">// api endpoint</div>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setApiBase(base);
                setEditing(false);
              }}
              className="flex gap-2"
            >
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="flex-1 font-mono text-xs px-2 py-1.5 bg-background border border-border focus:outline-none focus:border-primary"
              />
              <button className="font-mono text-xs px-3 py-1.5 bg-primary text-primary-foreground">save</button>
            </form>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="font-mono text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {base} ↗
            </button>
          )}
          <p className="text-[11px] text-muted-foreground mt-2 font-mono">
            change if your FastAPI is hosted elsewhere
          </p>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container py-4 flex flex-col md:flex-row gap-2 justify-between font-mono text-[11px] text-muted-foreground">
          <span>© {new Date().getFullYear()} insurance intelligence engine — handcrafted, mostly.</span>
          <span>v0.1 · not financial advice · read your policy anyway</span>
        </div>
      </div>
    </footer>
  );
};
