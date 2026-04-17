// Insurance Intelligence Engine — typed API client.
// Override base URL by setting localStorage.IIE_API_BASE or VITE_IIE_API_BASE.

const DEFAULT_BASE = "http://localhost:8000";

export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const ls = window.localStorage.getItem("IIE_API_BASE");
    if (ls) return ls.replace(/\/$/, "");
  }
  // @ts-ignore
  const env = (import.meta as any)?.env?.VITE_IIE_API_BASE;
  return (env || DEFAULT_BASE).replace(/\/$/, "");
}

export function setApiBase(url: string) {
  window.localStorage.setItem("IIE_API_BASE", url.replace(/\/$/, ""));
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

async function streamPost(
  path: string, 
  body: unknown, 
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Server-Sent Events are separated by \n\n
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || ""; // Keep the incomplete line in the buffer
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") return;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.chunk) {
            onChunk(parsed.chunk);
          }
        } catch (e) {
          console.error("Error parsing SSE chunk:", dataStr, e);
        }
      }
    }
  }
}


/* ---------- Types ---------- */

export type SearchDepth = "basic" | "deep";

export interface IntakeRequest {
  session_id: string;
  user_input: string;
  age?: number | null;
  family_size?: number | null;
  pre_existing_conditions?: string | null;
  budget?: number | string | null;
  location?: string | null;
  goal?: string | null;
  search_depth?: SearchDepth;
  documents?: string | null;
}

export interface IntakeResponse {
  next_question: string;
  intake_complete: boolean;
  final_recommendation: string;
  market_context: Array<{ title?: string; snippet?: string; url?: string } | string>;
  extracted_profile: Record<string, unknown>;
}

export type StatusColor = "green" | "red" | "yellow" | "gray";

export interface ComparisonRow {
  feature: string;
  old_val: string;
  new_val: string;
  old_status: StatusColor;
  new_status: StatusColor;
}

export interface CompareResponse {
  financial_comparison: ComparisonRow[];
  coverage_comparison: ComparisonRow[];
  exclusions_comparison: ComparisonRow[];
  scenario_summary: string;
}

export interface ScenarioResponse {
  is_covered: boolean;
  status: string;
  estimated_out_of_pocket: string;
  explanation: string;
  relevant_clause: string;
}

export interface VisualSummary {
  deductible: { individual: number; family: number };
  max_out_of_pocket: number;
  copay: { pcp: string; specialist: string; er: string };
  coinsurance: string;
  waiting_periods: Array<{ condition: string; period: string }>;
  highlights: string[];
}

export interface ExclusionItem {
  feature: string;
  description: string;
  trap_rating: "low" | "medium" | "high" | string;
}

export interface HackrxResponse {
  answers?: string[];
  [k: string]: unknown;
}

/* ---------- Endpoints ---------- */

export const api = {
  intake: (b: IntakeRequest, s?: AbortSignal) => post<IntakeResponse>("/chat/intake", b, s),
  compare: (b: { old_policy: string; new_policy: string }, s?: AbortSignal) =>
    post<CompareResponse>("/compare_policies", b, s),
  simulate: (b: { policy_url: string; scenario: string; user_profile?: Record<string, unknown> }, s?: AbortSignal) =>
    post<ScenarioResponse>("/simulate_scenario", b, s),
  visualSummary: (b: { policy_url: string }, s?: AbortSignal) =>
    post<VisualSummary>("/get_visual_summary", b, s),
  exclusions: (b: { policy_url: string }, s?: AbortSignal) =>
    post<ExclusionItem[]>("/get_exclusions", b, s),
  hackrx: (b: { documents: string; questions: string[] }, s?: AbortSignal) =>
    post<HackrxResponse>("/hackrx/run", b, s),
  explainSnippet: (b: { snippet: string }, onChunk: (chunk: string) => void, s?: AbortSignal) =>
    streamPost("/explain_snippet", b, onChunk, s),
};

