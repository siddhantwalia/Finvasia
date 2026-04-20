import re
import asyncio
import logging
import httpx
import time
import json
from collections import OrderedDict
import os
import uuid
from fastapi import FastAPI, Header, HTTPException, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from typing import List, Dict, TypedDict, Optional, Annotated
from dotenv import load_dotenv
from langchain_core.prompts import PromptTemplate
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langgraph.graph import StateGraph, START, END

from fastapi.middleware.cors import CORSMiddleware
from model import (
    Prompt, llm, NomicEmbeddings, rewrite_llm, llm_json,
    INTAKE_AGENT_PROMPT, RECOMMENDATION_AGENT_PROMPT,
    SCENARIO_SIMULATOR_PROMPT,
    VISUAL_SUMMARY_PROMPT, EXCLUSIONS_PROMPT,
    SEARCH_QUERY_PROMPT, MARKET_ANALYSIS_PROMPT, EXPLAINER_PROMPT
)
from duckduckgo_search import DDGS
from utils import parse_document_from_url, split_documents

# ---------------------- CONFIG / TUNABLES ---------------------- #
load_dotenv()
app = FastAPI()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Embedding batching & concurrency (tune based on your API limits)
BATCH_SIZE = 128  # number of chunks per embedding request
MAX_CONCURRENT_EMBED_CALLS = 3  # concurrency of simultaneous embedding API calls
EMBED_ROG_RETRY_MAX = 3  # retry attempts for 429s or transient failures
EMBED_RETRY_BACKOFF_BASE = 0.6  # exponential backoff base (seconds)

# HTTP fetching limits
HTTP_MAX_CONNECTIONS = 20
HTTP_TIMEOUT = 10  # seconds
HTTP_RETRY_MAX = 3
HTTP_RETRY_BACKOFF_BASE = 0.6

# Cache limits to prevent memory leaks
MAX_CACHE_SIZE = 100

# cache structures
faiss_cache: Dict[str, FAISS] = OrderedDict()  # doc_key -> faiss_db (simplified as requested)
embedding_cache: Dict[int, List[float]] = OrderedDict()  # hash(text) -> embedding (to avoid re-embedding duplicates)
session_store: Dict[str, dict] = {}  # session_id -> accumulated agent state

# --- File Upload Setup ---
UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Add CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    documents: str
    questions: List[str]




class ScenarioRequest(BaseModel):
    policy_url: str
    scenario: str
    user_profile: Optional[Dict] = None


class VisualSummaryRequest(BaseModel):
    policy_url: str


class ExclusionsRequest(BaseModel):
    policy_url: str


class IntakeRequest(BaseModel):
    session_id: str
    user_input: str
    chat_history: List[str] = []
    age: Optional[int] = None
    family_size: Optional[str] = None
    pre_existing_conditions: Optional[str] = None
    budget: Optional[str] = None
    location: Optional[str] = None
    goal: Optional[str] = None
    search_depth: Optional[str] = "basic"  # "basic" (snippets) or "deep" (crawled)
    documents: Optional[str] = None
    
class ExplainerRequest(BaseModel):
    snippet: str

class AgentState(TypedDict):
    session_id: str
    chat_history: List[str]
    user_input: str
    age: Optional[int]
    family_size: Optional[str]
    pre_existing_conditions: Optional[str]
    budget: Optional[str]
    location: Optional[str]
    goal: Optional[str]
    search_depth: str
    market_context: List[str]
    search_queries: List[str]
    intake_complete: bool
    retrieved_policies: List[str]
    final_recommendation: str
    documents: Optional[str]
    next_question: Optional[str]
    auth_token: Optional[str]


# ---------------------- Helpers ---------------------- #
def clean_output(answer):
    """Remove <think> tags and excessive spacing."""
    if hasattr(answer, "content"):
        content = answer.content
    else:
        content = str(answer)
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
    return re.sub(r"\n{3,}", "\n\n", content)


async def rewrite_question(original_question: str, first_doc_chunk: str = "") -> str:
    """Rewrite question for better retrieval (kept optional)."""
    prompt_template_str = """
You are an expert document analyst with strong reasoning skills.

Your task is to rewrite the user question into a precise, keyword-rich query to retrieve correct context from the document.

Use intelligence to smartly identify and emphasize key concepts such as "favorite city", "landmarks", "flight numbers", and any city names.

Remove irrelevant details and keep only terms that will help retrieve the exact info about the user's favorite city and related flight details.

Document Chunk:
{first_doc_chunk}

Original Question:
{original_question}

Rewritten Query:
"""

    prompt_text = PromptTemplate(
        input_variables=["original_question", "first_doc_chunk"],
        template=prompt_template_str
    )
    try:
        formatted_prompt = await prompt_text.ainvoke({
            "original_question": original_question,
            "first_doc_chunk": first_doc_chunk
        })
        rewritten = await rewrite_llm.ainvoke(formatted_prompt)
        logger.info(f"Rewritten question: {rewritten.content.strip()}")
        return rewritten.content.strip() if hasattr(rewritten, "content") else str(rewritten).strip()
    except Exception as e:
        logger.warning(f"Rewrite error, using original question: {e}")
        return original_question


# ----- Robust HTTP fetch for URLs (concurrent, limited, with retries) -----
async def fetch_url(client: httpx.AsyncClient, url: str, auth_token: str = None) -> str:
    """Fetch URL content (with optional Authorization) using provided client, with retries."""

    # --- UPDATE HEADERS TO INCLUDE BROWSER SPOOFING ---
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if auth_token:
        headers["Authorization"] = auth_token

    last_exc = None
    for attempt in range(HTTP_RETRY_MAX):
        try:
            # Pass the updated headers here
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.text.strip()
        except httpx.HTTPStatusError as e:
            last_exc = e
            if e.response.status_code == 429:
                backoff = HTTP_RETRY_BACKOFF_BASE * (2 ** attempt) + (attempt * 0.1)
                logger.warning(
                    f"Rate-limited fetching {url} (attempt {attempt + 1}/{HTTP_RETRY_MAX}). Backing off {backoff:.2f}s.")
                await asyncio.sleep(backoff)
                continue
            raise
        except Exception as e:
            last_exc = e
            logger.debug(f"Fetch URL error for {url}: {e}")
            backoff = HTTP_RETRY_BACKOFF_BASE * (2 ** attempt) + (attempt * 0.1)
            await asyncio.sleep(backoff)
    return f"<ERROR fetching {url}: {last_exc}>"


async def enrich_document_with_urls_fast(text_chunks: List[str], auth_token: str = None,
                                         max_conn: int = HTTP_MAX_CONNECTIONS) -> tuple[List[str], list[str]]:
    """Find all unique URLs, fetch them concurrently, append their content once per URL. Returns enriched chunks and found_urls."""
    url_pattern = r"https?://[^\s)>\]]+"
    found_urls = list(dict.fromkeys(re.findall(url_pattern, " ".join(text_chunks))))  # Unique in order

    if not found_urls:
        return text_chunks, found_urls

    logger.info(f"Found {len(found_urls)} unique URLs in document. Fetching concurrently...")
    limits = httpx.Limits(max_connections=max_conn)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, limits=limits) as client:
        tasks = [fetch_url(client, u, auth_token) for u in found_urls]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    # Build map url -> content (string)
    url_content_map = {}
    for u, r in zip(found_urls, responses):
        if isinstance(r, Exception):
            url_content_map[u] = f"<ERROR fetching {u}: {r}>"
        else:
            url_content_map[u] = r

    # Append fetched content only once per URL, distributing to first chunk where it appears
    enriched_chunks = text_chunks[:]
    appended_urls = set()
    for i, chunk in enumerate(enriched_chunks):
        for u in found_urls:
            if u in chunk and u not in appended_urls:
                enriched_chunks[i] += f"\n\n[Fetched from {u}]:\n{url_content_map[u]}"
                appended_urls.add(u)
    return enriched_chunks, found_urls


# ----- Embedding helpers: dedupe + concurrency + retry -----
def _hash_text_to_int(text: str) -> int:
    """Stable int hash for mapping into embedding_cache."""
    import hashlib
    return int.from_bytes(hashlib.sha1(text.encode("utf-8")).digest()[:8], "big")


async def _embed_with_retries(embedding_model, texts: List[str], retries=EMBED_ROG_RETRY_MAX,
                              backoff_base=EMBED_RETRY_BACKOFF_BASE):
    """Call embedding_model.embed_documents in a thread with retries on transient errors."""
    last_exc = None
    for attempt in range(retries):
        try:
            embeds = await asyncio.to_thread(embedding_model.embed_documents, texts)
            return embeds
        except Exception as e:
            last_exc = e
            s = str(e).lower()
            if "429" in s or "rate" in s or "too many" in s or "try again" in s:
                backoff = backoff_base * (2 ** attempt) + (attempt * 0.1)
                logger.warning(
                    f"Embedding call rate-limited or transient error (attempt {attempt + 1}/{retries}). Backing off {backoff:.2f}s. err={e}")
                await asyncio.sleep(backoff)
                continue
            else:
                raise
    logger.error(f"Embedding failed after {retries} attempts: {last_exc}")
    raise last_exc


async def build_faiss_concurrent(docs: List[Document], embedding_model, batch_size: int = BATCH_SIZE,
                                 max_concurrent: int = MAX_CONCURRENT_EMBED_CALLS) -> FAISS:
    """
    Embed documents in parallel batches with concurrency control and deduplication.
    Returns a langchain FAISS vectorstore built from (text, embedding) pairs.
    """
    # 1. Deduplicate texts while preserving order
    unique_texts = []
    text_to_original_indices = {}
    for i, d in enumerate(docs):
        txt = d.page_content
        if txt not in text_to_original_indices:
            text_to_original_indices[txt] = []
            unique_texts.append(txt)
        text_to_original_indices[txt].append(i)

    logger.info(
        f"Embedding {len(unique_texts)} unique chunks (from {len(docs)} total chunks). Batch size={batch_size}, concurrency={max_concurrent}")

    # 2. Check embedding_cache
    texts_to_embed = []
    embed_positions = []
    all_embeddings = [None] * len(unique_texts)
    for idx, txt in enumerate(unique_texts):
        key = _hash_text_to_int(txt)
        if key in embedding_cache:
            all_embeddings[idx] = embedding_cache[key]
        else:
            embed_positions.append(idx)
            texts_to_embed.append(txt)

    if texts_to_embed:
        semaphore = asyncio.Semaphore(max_concurrent)

        async def embed_batches_worker():
            tasks = []
            for i in range(0, len(texts_to_embed), batch_size):
                batch = texts_to_embed[i:i + batch_size]

                async def _embed_batch(b):
                    async with semaphore:
                        return await _embed_with_retries(embedding_model, b)

                tasks.append(asyncio.create_task(_embed_batch(batch)))

            batch_results = await asyncio.gather(*tasks)
            flat_embeds = [emb for br in batch_results for emb in br]

            for pos_idx, emb in zip(embed_positions, flat_embeds):
                all_embeddings[pos_idx] = emb
                key = _hash_text_to_int(unique_texts[pos_idx])
                embedding_cache[key] = emb
                if len(embedding_cache) > MAX_CACHE_SIZE:
                    embedding_cache.pop(next(iter(embedding_cache)))  # Evict oldest

        await embed_batches_worker()

    # Sanity check
    missing = [i for i, e in enumerate(all_embeddings) if e is None]
    if missing:
        raise RuntimeError(f"Missing embeddings for indices {missing}")

    # 3. Build FAISS
    pairs = list(zip(unique_texts, all_embeddings))
    try:
        vs = FAISS.from_embeddings(pairs, embedding_model)
    except Exception as e:
        logger.warning(f"FAISS.from_embeddings failed: {e}. Using manual add_embeddings fallback.")
        vs = FAISS(embedding_model)
        vs.add_embeddings(pairs)  # Use existing embeddings

    return vs


# ---------------------- API ---------------------- #
@app.get("/")
async def home():
    return {"home": "This is our unified API endpoint"}


# ----- FAISS Retrieval Helper -----
async def get_or_build_faiss(documents_url: str, auth_token: str = None) -> FAISS:
    """Gets cached FAISS or builds a new one from a URL."""
    import hashlib
    doc_key = hashlib.sha256(documents_url.encode()).hexdigest()

    if doc_key in faiss_cache:
        logger.info(f"Using cached FAISS for {documents_url[:50]}...")
        return faiss_cache[doc_key]

    # 1. Parse document
    try:
        parsed_docs = await parse_document_from_url(documents_url)
    except Exception as e:
        logger.error(f"Error parsing document: {e}")
        raise HTTPException(status_code=400, detail=f"Error parsing document: {e}")

    # 2. Split into chunks
    try:
        chunks = split_documents(parsed_docs)
    except Exception as e:
        logger.error(f"Error splitting document: {e}")
        raise HTTPException(status_code=500, detail=f"Error splitting document: {e}")

    text_list = [c.page_content for c in chunks]

    # 3. Enrich URLs concurrently
    enriched_text_list, found_urls = await enrich_document_with_urls_fast(text_list, auth_token,
                                                                          max_conn=HTTP_MAX_CONNECTIONS)

    # 4. Build embeddings + FAISS
    try:
        embedding_model = NomicEmbeddings()
        enriched_chunks = [Document(page_content=t) for t in enriched_text_list]
        db = await build_faiss_concurrent(enriched_chunks, embedding_model, batch_size=BATCH_SIZE,
                                          max_concurrent=MAX_CONCURRENT_EMBED_CALLS)
    except Exception as e:
        logger.exception("Embedding/Vector store error")
        raise HTTPException(status_code=500, detail=f"Embedding/Vector store error: {e}")

    # 5. Conditional caching
    if len(found_urls) == 0:
        faiss_cache[doc_key] = db
        if len(faiss_cache) > MAX_CACHE_SIZE:
            faiss_cache.pop(next(iter(faiss_cache)))
        logger.info("FAISS index built and cached")
    else:
        logger.info("Document contains URLs, skipping FAISS cache storage")

    return db


# ---------------------- API ---------------------- #
@app.get("/")
async def home():
    return {"home": "This is our unified API endpoint"}


@app.post("/hackrx/run")
async def run_query(req: QueryRequest, Authorization: str = Header(default=None)):
    start = time.time()
    db = await get_or_build_faiss(req.documents, Authorization)
    retriever = db.as_retriever(search_type="mmr", search_kwargs={"k": 5, "lambda_mult": 0.3})

    # Process questions in parallel
    async def process_q(question: str):
        try:
            # Optional rewrite (commented to optimize speed; uncomment if needed)
            # first_chunk = ""  # No longer caching enriched list, so fallback to empty
            # rewritten_question = await rewrite_question(question, first_chunk)
            rewritten_question = question

            context_docs = await asyncio.to_thread(retriever.invoke, rewritten_question)
            context = "\n".join([doc.page_content for doc in context_docs]) if context_docs else ""
            context = context[:8000]  # Truncate to avoid token limits

            inputs = {"context": context, "question": question}
            answer = await (Prompt | llm).ainvoke(inputs)
            return clean_output(answer)
        except Exception as e:
            logger.exception(f"Error processing question '{question}': {e}")
            return f"Error: {e}"

    answers = await asyncio.gather(*[process_q(q) for q in req.questions])

    elapsed = time.time() - start
    logger.info(f"Total run_query time: {elapsed:.2f}s")
    return {"answers": answers}




@app.post("/simulate_scenario")
async def simulate_scenario(req: ScenarioRequest, Authorization: str = Header(default=None)):
    """Adjudicate a hypothetical scenario against a policy."""
    db = await get_or_build_faiss(req.policy_url, Authorization)
    retriever = db.as_retriever(search_kwargs={"k": 5})
    
    # Retrieve context relevant to the scenario
    context_docs = await asyncio.to_thread(retriever.invoke, req.scenario)
    context = "\n".join([d.page_content for d in context_docs])
    
    chain = SCENARIO_SIMULATOR_PROMPT | llm_json
    response = await chain.ainvoke({
        "context": context,
        "user_profile": json.dumps(req.user_profile or {}),
        "scenario": req.scenario
    })
    
    return json.loads(response.content if hasattr(response, "content") else response)


@app.post("/get_visual_summary")
async def get_visual_summary(req: VisualSummaryRequest, Authorization: str = Header(default=None)):
    """Extract financial metrics for visual dashboard."""
    db = await get_or_build_faiss(req.policy_url, Authorization)
    # Get high-level summary parts
    docs = await asyncio.to_thread(db.as_retriever(search_kwargs={"k": 8}).invoke, "financial summary, deductible, copay, out of pocket max")
    context = "\n".join([d.page_content for d in docs])
    
    chain = VISUAL_SUMMARY_PROMPT | llm_json
    response = await chain.ainvoke({"context": context})
    
    return json.loads(response.content if hasattr(response, "content") else response)


@app.post("/get_exclusions")
async def get_exclusions(req: ExclusionsRequest, Authorization: str = Header(default=None)):
    """Identify policy traps and exclusions."""
    db = await get_or_build_faiss(req.policy_url, Authorization)
    # Search specifically for exclusions
    docs = await asyncio.to_thread(db.as_retriever(search_kwargs={"k": 8}).invoke, "exclusions, what is not covered, limitations, traps")
    context = "\n".join([d.page_content for d in docs])
    
    chain = EXCLUSIONS_PROMPT | llm_json
    response = await chain.ainvoke({"context": context})
    
    return json.loads(response.content if hasattr(response, "content") else response)


@app.post("/explain_snippet")
async def explain_snippet(req: ExplainerRequest):
    """Explain a complex policy snippet in 5th-grader terms via SSE Stream."""
    chain = EXPLAINER_PROMPT | llm
    
    async def generate_stream():
        in_think_block = False
        async for chunk in chain.astream({"snippet": req.snippet}):
            content = chunk.content if hasattr(chunk, "content") else str(chunk)
            if not content:
                continue
            
            # Simple state machine to drop <think> blocks across chunks
            if "<think>" in content:
                in_think_block = True
                content = content.split("<think>")[0]
            if "</think>" in content:
                in_think_block = False
                content = content.split("</think>")[-1]
                
            if not in_think_block and content.strip() or content.isspace(): # preserve spaces
                yield f"data: {json.dumps({'chunk': content})}\n\n"
                
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate_stream(), media_type="text/event-stream")


@app.post("/upload_policy")
async def upload_policy(file: UploadFile = File(...)):
    """Upload a policy file and return its local static URL."""
    # Validate extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".pdf", ".docx", ".png", ".jpg", ".jpeg"]:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    # 50MB limit check (FastAPI doesn't do this by default, we'll check it during read)
    file_content = await file.read()
    if len(file_content) > 50 * 1024 * 1024:  # 50MB
        raise HTTPException(status_code=413, detail="File too large. Max 50MB.")

    # Generate unique filename
    unique_filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    with open(file_path, "wb") as f:
        f.write(file_content)

    # Return local static URL
    # In a real app, you'd use the base URL from the request, but for now we'll assume localhost:8000
    # or handle it on the frontend by prepending the base URL.
    return {"url": f"/uploads/{unique_filename}"}


@app.get("/proxy_pdf")
async def proxy_pdf(url: str):
    """Proxy PDF files to bypass CORS for the frontend React-PDF viewer."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to fetch PDF: {response.status_code}")
            return Response(content=response.content, media_type="application/pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------- Agent Nodes & LangGraph ---------------------- #

async def information_gatherer_node(state: AgentState) -> AgentState:
    chain = INTAKE_AGENT_PROMPT | llm_json
    response = await chain.ainvoke({
        "chat_history": "\n".join(state.get("chat_history", [])),
        "user_input": state.get("user_input", ""),
        "age": state.get("age") or "",
        "family_size": state.get("family_size") or "",
        "pre_existing_conditions": state.get("pre_existing_conditions") or "",
        "budget": state.get("budget") or "",
        "location": state.get("location") or "",
        "goal": state.get("goal") or ""
    })

    try:
        data = json.loads(response.content if hasattr(response, "content") else response)
    except Exception as e:
        logger.error(f"Failed to parse JSON from information_gatherer: {e}")
        data = {}

    if "age" in data and data["age"]: state["age"] = data["age"]
    if "family_size" in data and data["family_size"]: state["family_size"] = data["family_size"]
    if "pre_existing_conditions" in data and data["pre_existing_conditions"]: state["pre_existing_conditions"] = data[
        "pre_existing_conditions"]
    if "budget" in data and data["budget"]: state["budget"] = data["budget"]
    if "location" in data and data["location"]: state["location"] = data["location"]
    if "goal" in data and data["goal"]: state["goal"] = data["goal"]

    if "next_question" in data:
        state["next_question"] = data["next_question"]

    state["intake_complete"] = data.get("intake_complete", False)
    state["market_context"] = state.get("market_context", [])
    state["search_queries"] = state.get("search_queries", [])

    return state


async def market_search_node(state: AgentState) -> AgentState:
    """Generates search queries and fetches real-time market data."""
    # 1. Generate Query strings (use regular llm, NOT llm_json — Groq rejects arrays in json_object mode)
    chain = SEARCH_QUERY_PROMPT | llm
    try:
        response = await chain.ainvoke({
            "age": state.get("age") or "unknown",
            "family_size": state.get("family_size") or "unknown",
            "location": state.get("location") or "unknown",
            "goal": state.get("goal") or "unknown"
        })

        raw = response.content if hasattr(response, "content") else response
        # Strip any markdown code fences the LLM might add
        clean = raw.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        clean = clean.strip()

        parsed = json.loads(clean)
        # Handle both {"queries": [...]} and raw [...] formats
        if isinstance(parsed, dict) and "queries" in parsed:
            queries = parsed["queries"]
        elif isinstance(parsed, list):
            queries = parsed
        else:
            queries = list(parsed.values())[0] if parsed else []
        state["search_queries"] = [q for q in queries if isinstance(q, str)][:5]
    except Exception as e:
        logger.error(f"Failed to generate/parse search queries: {e}")
        # Fallback: generate a basic query from profile
        fallback = f"{state.get('goal', 'insurance')} for {state.get('age', '')} year old in {state.get('location', 'India')} {state.get('family_size', '')}"
        state["search_queries"] = [fallback.strip()]

    # 2. Execute Search
    market_findings = []
    
    async def fallback_search(q: str):
        url = "https://lite.duckduckgo.com/lite/"
        headers = {"User-Agent": "Mozilla/5.0"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, data={"q": q}, headers=headers)
                if resp.status_code == 200:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    snippets = []
                    for td in soup.find_all("td", class_="result-snippet"):
                        snippets.append({"body": td.get_text(separator=" ", strip=True), "href": "lite_search", "title": "Search Result"})
                    return snippets[:3]
        except Exception:
            pass
        return []

    for query in state["search_queries"]:
        try:
            # Attempt DDGS first
            results = []
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=3))
            
            # If DDGS failed to return results (rate limited), use robust fallback
            if not results:
                results = await fallback_search(query)

            for r in results:
                snippet = f"Source: {r['href']}\nTitle: {r['title']}\nSnippet: {r['body']}"
                
                if state.get("search_depth") == "deep" and r['href'] != "lite_search":
                    # Attempt to crawl and ingest the actual page
                    try:
                        async with httpx.AsyncClient(timeout=8.0) as client:
                            resp = await client.get(r['href'], follow_redirects=True)
                            if resp.status_code == 200:
                                from bs4 import BeautifulSoup
                                soup = BeautifulSoup(resp.text, "html.parser")
                                text = soup.get_text(separator="\n")
                                clean_text = "\n".join(line.strip() for line in text.splitlines() if line.strip())[:2500]
                                snippet += f"\nDeep Content: {clean_text}"
                    except Exception as crawl_err:
                        logger.warning(f"Failed deep crawl for {r['href']}: {crawl_err}")

                market_findings.append(snippet)
        except Exception as search_err:
            logger.error(f"Search failed for query '{query}': {search_err}")
            # Ensure we try fallback even if DDGS throws an exception
            results = await fallback_search(query)
            for r in results:
                market_findings.append(f"Source: {r['href']}\nTitle: {r['title']}\nSnippet: {r['body']}")

    state["market_context"] = market_findings
    return state


async def policy_retriever_node(state: AgentState) -> AgentState:
    doc_url = state.get("documents")
    if not doc_url:
        logger.warning("No documents URL provided in state, skipping retrieval.")
        state["retrieved_policies"] = []
        return state

    try:
        db = await get_or_build_faiss(doc_url, state.get("auth_token"))
    except Exception as e:
        logger.error(f"Failed to retrieve/build FAISS in agent block: {e}")
        state["retrieved_policies"] = []
        return state

    retriever = db.as_retriever(search_type="mmr", search_kwargs={"k": 5, "lambda_mult": 0.3})

    # Synthesize the search query based on agent parameters
    search_query = f"insurance policy details for age {state.get('age')}, family {state.get('family_size')}, profile: {state.get('pre_existing_conditions')}"

    try:
        context_docs = await asyncio.to_thread(retriever.invoke, search_query)
        context = "\n".join([doc.page_content for doc in context_docs]) if context_docs else ""
        context = context[:8000]
        state["retrieved_policies"] = [context]
    except Exception as e:
        logger.error(f"Failed to query FAISS retriever: {e}")
        state["retrieved_policies"] = []

    return state


async def recommendation_node(state: AgentState) -> AgentState:
    chain = MARKET_ANALYSIS_PROMPT | llm

    context = state.get("retrieved_policies", [])
    context_str = context[0] if context else "No internal policies provided."
    
    market_str = "\n---\n".join(state.get("market_context", [])) or "No real-time market data found."

    response = await chain.ainvoke({
        "context": context_str,
        "market_data": market_str,
        "age": state.get("age") or "Not specified",
        "family_size": state.get("family_size") or "Not specified",
        "pre_existing_conditions": state.get("pre_existing_conditions") or "Not specified",
        "budget": state.get("budget") or "Not specified",
        "location": state.get("location") or "Not specified",
        "goal": state.get("goal") or "Not specified"
    })

    state["final_recommendation"] = clean_output(response)
    return state


def should_continue(state: AgentState):
    if state.get("intake_complete"):
        return "market_search_node"  # Always prioritize market search
    else:
        return END


# Compile Graph
graph_builder = StateGraph(AgentState)
graph_builder.add_node("information_gatherer_node", information_gatherer_node)
graph_builder.add_node("market_search_node", market_search_node)
graph_builder.add_node("policy_retriever_node", policy_retriever_node)
graph_builder.add_node("recommendation_node", recommendation_node)

graph_builder.add_edge(START, "information_gatherer_node")
graph_builder.add_conditional_edges("information_gatherer_node", should_continue)
graph_builder.add_edge("market_search_node", "policy_retriever_node")
graph_builder.add_edge("policy_retriever_node", "recommendation_node")
graph_builder.add_edge("recommendation_node", END)

agent_graph = graph_builder.compile()


@app.post("/chat/intake")
async def chat_intake(req: IntakeRequest, Authorization: str = Header(default=None)):
    # ---- Restore session memory ----
    prev = session_store.get(req.session_id, {})

    # Merge: prefer explicit request fields, then session memory, then defaults
    def pick(field, default=None):
        val = getattr(req, field, None)
        if val is not None:
            return val
        return prev.get(field, default)

    # Build chat history: append the new user message to whatever we had before
    chat_history = list(prev.get("chat_history", []))
    # Add the previous agent question if we have one
    prev_question = prev.get("next_question")
    if prev_question:
        chat_history.append(f"Agent: {prev_question}")
    chat_history.append(f"User: {req.user_input}")

    initial_state = {
        "session_id": req.session_id,
        "user_input": req.user_input,
        "chat_history": chat_history,
        "age": pick("age"),
        "family_size": pick("family_size"),
        "pre_existing_conditions": pick("pre_existing_conditions"),
        "budget": pick("budget"),
        "location": pick("location"),
        "goal": pick("goal"),
        "search_depth": req.search_depth or prev.get("search_depth", "basic"),
        "documents": pick("documents"),
        "auth_token": Authorization,
        "intake_complete": False,
        "retrieved_policies": [],
        "market_context": [],
        "search_queries": [],
        "final_recommendation": "",
        "next_question": ""
    }

    try:
        final_state = await agent_graph.ainvoke(initial_state)

        # ---- Persist session memory ----
        session_store[req.session_id] = {
            "age": final_state.get("age"),
            "family_size": final_state.get("family_size"),
            "pre_existing_conditions": final_state.get("pre_existing_conditions"),
            "budget": final_state.get("budget"),
            "location": final_state.get("location"),
            "goal": final_state.get("goal"),
            "search_depth": final_state.get("search_depth", "basic"),
            "documents": final_state.get("documents"),
            "chat_history": final_state.get("chat_history", []),
            "next_question": final_state.get("next_question", ""),
        }

        # ---- Build frontend-friendly response ----
        profile_fields = ["age", "family_size", "pre_existing_conditions", "budget", "location", "goal"]
        extracted_profile = {k: final_state.get(k) for k in profile_fields if final_state.get(k)}

        return {
            "next_question": final_state.get("next_question", ""),
            "intake_complete": final_state.get("intake_complete", False),
            "final_recommendation": final_state.get("final_recommendation", ""),
            "market_context": final_state.get("market_context", []),
            "extracted_profile": extracted_profile,
        }
    except Exception as e:
        logger.exception("Agent graph failed")
        raise HTTPException(status_code=500, detail=str(e))
