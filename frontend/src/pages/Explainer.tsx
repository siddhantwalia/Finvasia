import { useState, useRef, useEffect } from "react";
import { Shell } from "@/components/layout/Shell";
import { PageHeader } from "@/components/PageHeader";
import { PolicyUrlInput } from "@/components/PolicyUrlInput";
import { api, getApiBase } from "@/lib/api";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Setup pdf worker using local bundle (Vite compatible)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function Explainer() {
  const [url, setUrl] = useState<string>("");
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [selectedText, setSelectedText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  const textContainerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  // Capture selection from the window
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        setSelectedText(selection.toString().trim());
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const explainSelection = async () => {
    if (!selectedText) {
      toast.error("Please highlight text from the document first.");
      return;
    }
    setLoading(true);
    setExplanation("");
    try {
      await api.explainSnippet(
        { snippet: selectedText },
        (chunk) => {
          setExplanation((prev) => prev + chunk);
        }
      );
    } catch (e: any) {
      toast.error("Failed to explain", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell>
      <PageHeader
        index="04"
        kicker="POST /explain_snippet"
        title="Live Policy Explainer"
        blurb="Load a policy PDF, highlight any confusing jargon, and let the agent translate it to 5th-grade terms instantly."
      />
      <div className="container py-6 grid gap-6 h-[calc(100vh-140px)] min-h-[800px] grid-rows-[auto_1fr]">
        <PolicyUrlInput onSubmit={setUrl} loading={false} cta="Load PDF" />

        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6 overflow-hidden h-full">

          {/* Left Panel: PDF Viewer */}
          <div className="quant-card overflow-hidden flex flex-col h-full bg-muted/20">
            <div className="p-3 border-b border-border bg-card flex justify-between items-center z-10">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Live Document Viewer
              </span>
              {numPages && (
                <div className="flex gap-2 items-center text-xs font-mono">
                  <button 
                    disabled={pageNumber <= 1} 
                    onClick={() => setPageNumber(p => p - 1)}
                    className="hover:text-primary disabled:opacity-50"
                  >
                    PREV
                  </button>
                  <span>{pageNumber} / {numPages}</span>
                  <button 
                    disabled={pageNumber >= numPages} 
                    onClick={() => setPageNumber(p => p + 1)}
                    className="hover:text-primary disabled:opacity-50"
                  >
                    NEXT
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex-1 overflow-auto p-4 flex justify-center custom-scrollbar" ref={textContainerRef}>
              {url ? (
                <Document
                  file={`${getApiBase()}/proxy_pdf?url=${encodeURIComponent(url)}`}
                  onLoadSuccess={onDocumentLoadSuccess}
                  loading={<div className="font-mono text-sm text-muted-foreground mt-10">Loading PDF...</div>}
                  error={<div className="font-mono text-xs text-red-500 mt-10 p-4 border border-red-500/20 bg-red-500/10">Failed to load PDF. Check if URL allows CORS.</div>}
                >
                  <Page 
                    pageNumber={pageNumber} 
                    renderTextLayer={true} 
                    renderAnnotationLayer={true} 
                    className="shadow-xl"
                  />
                </Document>
              ) : (
                <div className="font-mono text-sm text-muted-foreground mt-20">No document loaded. Paste a URL above.</div>
              )}
            </div>
          </div>

          {/* Right Panel: Explainer Agent Sidebar */}
          <div className="quant-card flex flex-col h-full overflow-hidden">
            <div className="p-3 border-b border-border bg-card">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Agent Explainer Panel
              </span>
            </div>
            
            <div className="flex-1 overflow-auto p-5 pb-20 custom-scrollbar flex flex-col gap-6">
              <div className="text-sm text-muted-foreground leading-relaxed break-words relative">
                <div className="font-mono text-[10px] uppercase tracking-widest mb-2 text-primary">// Selected Text</div>
                {selectedText ? (
                  <blockquote className="border-l-2 border-primary/50 pl-3 italic opacity-80">
                    "{selectedText}"
                  </blockquote>
                ) : (
                  <span className="opacity-50">Select text from the PDF on the left to begin...</span>
                )}
              </div>

              <div className="mt-auto">
                <button 
                  onClick={explainSelection}
                  disabled={!selectedText || loading}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs uppercase p-3 tracking-widest transition-colors disabled:opacity-50"
                >
                  {loading ? "Translating..." : "Explain Selection"}
                </button>
              </div>

              {explanation && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="font-mono text-[10px] uppercase tracking-widest mb-3 text-emerald-500">// AI Translation</div>
                  <div className="text-sm leading-relaxed text-foreground bg-primary/5 border border-primary/10 p-4 rounded-sm prose prose-sm dark:prose-invert">
                    <ReactMarkdown>{explanation}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
