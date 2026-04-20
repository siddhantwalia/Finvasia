import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { api, getApiBase } from "@/lib/api";
import { toast } from "sonner";
import { Upload } from "lucide-react";

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
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const id = toast.loading("Uploading file...");
    try {
      const { url } = await api.uploadPolicy(file);
      // Prepend API base if it's a relative path starting with /uploads
      const fullUrl = url.startsWith("http") ? url : `${getApiBase()}${url}`;
      setVal(fullUrl);
      toast.success("Uploaded successfully", { id });
      onSubmit(fullUrl);
    } catch (err: any) {
      toast.error("Upload failed", { id, description: err.message });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (val.trim()) onSubmit(val.trim()); }}
      className="quant-card p-4 md:p-5 grid gap-3"
    >
      <label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">// {label}</label>
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1 flex">
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            className="flex-1 font-mono text-sm px-3 py-2.5 bg-background border border-border focus:outline-none focus:border-primary pr-12"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || isUploading}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-primary disabled:opacity-50"
            title="Upload PDF"
          >
            <Upload size={16} />
          </button>
        </div>
        
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          className="hidden"
          accept=".pdf,.docx,.jpg,.jpeg,.png"
        />

        <Button type="submit" disabled={loading || isUploading || !val.trim()} className="rounded-none font-mono uppercase tracking-widest text-xs h-auto px-5">
          {loading || isUploading ? "working…" : cta}
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
