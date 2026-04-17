import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  cta?: string;
  onSubmit: (url: string) => void;
  loading?: boolean;
}

const SAMPLE = "https://hackrx.blob.core.windows.net/assets/policy.pdf";

export const PolicyUrlInput = ({ label = "policy_url", placeholder = "https://…/policy.pdf or paste raw text", defaultValue = "", cta = "run", onSubmit, loading }: Props) => {
  const [val, setVal] = useState(defaultValue);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (val.trim()) onSubmit(val.trim()); }}
      className="quant-card p-4 md:p-5 grid gap-3"
    >
      <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// {label}</label>
      <div className="flex flex-col md:flex-row gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="flex-1 font-mono text-sm px-3 py-2.5 bg-background border border-border focus:outline-none focus:border-primary"
        />
        <Button type="submit" disabled={loading || !val.trim()} className="rounded-none font-mono uppercase tracking-widest text-xs h-auto px-5">
          {loading ? "running…" : cta}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setVal(SAMPLE)}
        className="font-mono text-[11px] text-muted-foreground hover:text-primary text-left underline-offset-4 hover:underline w-fit"
      >
        ↳ use sample policy URL
      </button>
    </form>
  );
};
