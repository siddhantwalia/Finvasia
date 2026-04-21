import re
import asyncio
import logging
import httpx
import time
import json
from collections import OrderedDict
import os
import uuid
from fastapi import FastAPI, Header, HTTPException, File, UploadFile, Request
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
    SEARCH_QUERY_PROMPT, MARKET_ANALYSIS_PROMPT, EXPLAINER_PROMPT,
    MARKET_REFINE_PROMPT
)
from duckduckgo_search import DDGS
from serpapi import GoogleSearch
from utils import parse_document_from_url, split_documents

# ---------------------- CONFIG / TUNABLES ---------------------- #
load_dotenv()
SERP_API_KEY = os.getenv("SERP_API_KEY")
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
    documents: Optional[str] = None  # Re-purposed/used for existing policy URL
    has_existing_policy: Optional[str] = None
    other_info: Optional[str] = None
    
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
    other_info: Optional[str]
    search_depth: str
    market_context: List[str]
    search_queries: List[str]
    intake_complete: bool
    retrieved_policies: List[str]
    final_recommendation: str
    documents: Optional[str]
    next_question: Optional[str]
    auth_token: Optional[str]
    refined_links: List[Dict[str, str]]
    recommendation_generated: bool
    has_existing_policy: Optional[str]
    existing_policy_summary: Optional[str]


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

    # 5. Cache the FAISS index (always — content is deterministic for the same doc)
    faiss_cache[doc_key] = db
    if len(faiss_cache) > MAX_CACHE_SIZE:
        faiss_cache.pop(next(iter(faiss_cache)))
    logger.info(f"FAISS index built and cached ({len(found_urls)} embedded URLs found)")

    return db


# ---------------------- API ---------------------- #
# @app.get("/")
# async def home():
#     return {"home": "This is our unified API endpoint"}


@app.post("/run")
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




class DocumentChatRequest(BaseModel):
    document_url: str
    question: str
    chat_history: Optional[List[str]] = []  # e.g. ["User: ...", "Agent: ..."]

@app.post("/chat/document")
async def chat_document(req: DocumentChatRequest, Authorization: str = Header(default=None)):
    """
    RAG-powered document Q&A with conversation memory.
    Uses small chunks for better granularity and multi-pass retrieval.
    """
    # Small-chunk FAISS (not cached globally — using a separate key)
    import hashlib
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from model import NomicEmbeddings
    
    doc_cache_key = "doc_chat_" + hashlib.sha256(req.document_url.encode()).hexdigest()
    if doc_cache_key not in faiss_cache:
        try:
            parsed_docs = await parse_document_from_url(req.document_url)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Cannot parse document: {e}")
        
        small_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=50)
        small_chunks = small_splitter.split_documents(parsed_docs)
        embedding_model = NomicEmbeddings()
        small_db = await build_faiss_concurrent(small_chunks, embedding_model, batch_size=64, max_concurrent=3)
        faiss_cache[doc_cache_key] = small_db
        logger.info(f"Built doc chat FAISS: {len(small_chunks)} chunks for {req.document_url[:50]}")
    
    small_db = faiss_cache[doc_cache_key]
    retriever = small_db.as_retriever(search_kwargs={"k": 6})
    
    # Multi-pass retrieval: use question + rephrase using recent history for better recall
    history_str = "\n".join(req.chat_history[-6:]) if req.chat_history else ""
    queries = [req.question]
    
    # Add a paraphrased fallback query based on key terms in the question
    keywords = " ".join(w for w in req.question.split() if len(w) > 3)
    if keywords != req.question:
        queries.append(keywords)
    
    seen, unique_content = set(), []
    for q in queries:
        for doc in await asyncio.to_thread(retriever.invoke, q):
            if doc.page_content not in seen:
                unique_content.append(doc.page_content)
                seen.add(doc.page_content)
    
    context = "\n---\n".join(unique_content)[:5000]
    
    # Build prompt with conversation memory
    doc_qa_prompt = f"""You are a helpful insurance policy expert answering questions about a specific policy document and conversing with the user.

Conversation History (for context & memory):
{history_str or "No prior conversation."}

Relevant Policy Sections:
{context}

User's Question: {req.question}

INSTRUCTIONS:
1. Use the "Relevant Policy Sections" to answer questions about the policy document.
2. You MUST ALSO use the "Conversation History" to recall any information the user has shared about themselves (e.g. their age, name, etc.) and to understand follow-up contexts.
3. If the user asks about something they already told you (like "what is my age"), answer based on the Conversation History.
4. Quote specific clauses or numbers where relevant when answering policy questions.
5. Fix typos in the question using context clues (e.g. "iscount" → "discount").
6. If the user asks a policy-specific question and the policy sections don't contain the answer, say: "I couldn't find this in the uploaded document — try asking differently."
7. Keep answers concise and clear.

Answer:"""

    response = await llm.ainvoke(doc_qa_prompt)
    answer = clean_output(response)
    
    return {"answer": answer, "context_chunks": len(unique_content)}


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
    """Extract financial metrics for visual dashboard using table-aware RAG."""
    # Parse document directly to get raw pages for re-chunking
    try:
        parsed_docs = await parse_document_from_url(req.policy_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing document: {e}")

    # Re-chunk with SMALL chunks (300 chars) so table rows are individual units
    # Financial PDFs have tables where each row is key data — large chunks lump them together
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from model import NomicEmbeddings
    small_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=30)
    small_chunks = small_splitter.split_documents(parsed_docs)
    
    embedding_model = NomicEmbeddings()
    small_db = await build_faiss_concurrent(small_chunks, embedding_model, batch_size=64, max_concurrent=3)
    
    retriever = small_db.as_retriever(search_kwargs={"k": 8})

    # 3 targeted searches covering the 3 financial data categories
    queries = [
        "Sum Insured coverage limit face value total insured amount ₹",
        "deductible excess co-payment copay coinsurance room rent ICU limit",
        "waiting period pre-existing disease maternity specific illness exclusion",
    ]

    seen, unique_content = set(), []
    for q in queries:
        for doc in await asyncio.to_thread(retriever.invoke, q):
            if doc.page_content not in seen:
                unique_content.append(doc.page_content)
                seen.add(doc.page_content)

    # Hard cap: keep under ~4,500 chars (~1,125 tokens) for context
    # leaving ~4,875 tokens for the prompt template + JSON output
    MAX_CONTEXT_CHARS = 4500
    context = "\n".join(unique_content)
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS]

    logger.info(f"Visual summary: {len(small_chunks)} small chunks, {len(unique_content)} retrieved, context={len(context)} chars")

    chain = VISUAL_SUMMARY_PROMPT | llm_json
    response = await chain.ainvoke({"context": context})

    return json.loads(response.content if hasattr(response, "content") else response)


@app.post("/get_exclusions")
async def get_exclusions(req: ExclusionsRequest, Authorization: str = Header(default=None)):
    """Identify policy traps and exclusions with consistent results."""
    # Parse fresh for targeted small-chunk RAG (same approach as visual_summary)
    try:
        parsed_docs = await parse_document_from_url(req.policy_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing document: {e}")

    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from model import NomicEmbeddings
    small_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=30)
    small_chunks = small_splitter.split_documents(parsed_docs)
    embedding_model = NomicEmbeddings()
    small_db = await build_faiss_concurrent(small_chunks, embedding_model, batch_size=64, max_concurrent=3)
    retriever = small_db.as_retriever(search_kwargs={"k": 10})

    # Targeted exclusion queries
    queries = [
        "exclusions not covered rejected claim limitation",
        "waiting period pre-existing disease sub-limit cap",
        "co-payment excess room rent ICU non-payable",
    ]
    seen, unique_content = set(), []
    for q in queries:
        for doc in await asyncio.to_thread(retriever.invoke, q):
            if doc.page_content not in seen:
                unique_content.append(doc.page_content)
                seen.add(doc.page_content)

    context = "\n".join(unique_content)[:4500]

    chain = EXCLUSIONS_PROMPT | llm_json
    response = await chain.ainvoke({"context": context})
    raw = json.loads(response.content if hasattr(response, "content") else response)

    # --- Backend normalization ---
    VALID_RATINGS = {"high", "medium", "low"}
    RATING_ORDER = {"high": 0, "medium": 1, "low": 2}

    normalized = []
    for item in (raw if isinstance(raw, list) else []):
        feature = str(item.get("feature", "")).strip()
        description = str(item.get("description", "")).strip()
        rating = str(item.get("trap_rating", "")).lower().strip()

        if not feature or not description:
            continue  # skip malformed items

        # Normalize rating: default to "medium" if unrecognized
        if rating not in VALID_RATINGS:
            rating = "medium"

        normalized.append({
            "feature": feature,
            "description": description,
            "trap_rating": rating,
        })

    # Sort: high → medium → low
    normalized.sort(key=lambda x: RATING_ORDER.get(x["trap_rating"], 99))

    return normalized


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
async def upload_policy(request: Request, file: UploadFile = File(...)):
    """Upload a policy file and return its absolute URL."""
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

    # Return absolute URL so parse_document_from_url can fetch it
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}/uploads/{unique_filename}"}


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
    # --- Live RAG: query attached document with user's question ---
    doc_context = ""
    doc_url = state.get("documents")
    user_q = state.get("user_input", "")
    if doc_url and user_q:
        try:
            doc_db = await get_or_build_faiss(doc_url, state.get("auth_token"))
            retriever = doc_db.as_retriever(search_kwargs={"k": 4})
            doc_results = await asyncio.to_thread(retriever.invoke, user_q)
            if doc_results:
                doc_context = "\n".join(d.page_content for d in doc_results)[:2000]
                logger.info(f"RAG doc context retrieved: {len(doc_context)} chars")
        except Exception as e:
            logger.warning(f"RAG doc query failed: {e}")

    chain = INTAKE_AGENT_PROMPT | llm_json
    response = await chain.ainvoke({
        "chat_history": "\n".join(state.get("chat_history", [])),
        "user_input": state.get("user_input", ""),
        "age": state.get("age") or "",
        "family_size": state.get("family_size") or "",
        "pre_existing_conditions": state.get("pre_existing_conditions") or "",
        "budget": state.get("budget") or "",
        "location": state.get("location") or "",
        "goal": state.get("goal") or "",
        "has_existing_policy": state.get("has_existing_policy") or "",
        "other_info": state.get("other_info") or "",
        "current_recommendation": state.get("final_recommendation", "None yet."),
        "doc_context": doc_context,
    })

    try:
        data = json.loads(response.content if hasattr(response, "content") else response)
    except Exception as e:
        logger.error(f"Failed to parse JSON from information_gatherer: {e}")
        data = {}

    # Change detection
    fields = ["age", "family_size", "pre_existing_conditions", "budget", "location", "goal", "has_existing_policy", "other_info"]
    any_change = False
    for f in fields:
        new_val = data.get(f)
        if new_val and new_val != state.get(f):
            state[f] = new_val
            any_change = True
            
    if any_change:
        logger.info(f"Profile change detected. Resetting recommendation flags.")
        state["recommendation_generated"] = False
        state["final_recommendation"] = ""
        state["market_context"] = []
        state["refined_links"] = []

    if "next_question" in data:
        state["next_question"] = data["next_question"]

    state["intake_complete"] = data.get("intake_complete", False)
    return state


# ---- Existing Policy Analysis Node ---- #
async def existing_policy_analysis_node(state: AgentState) -> AgentState:
    """Summarizes the user's existing policy for side-by-side comparison."""
    doc_url = state.get("documents")
    if not doc_url or state.get("existing_policy_summary"):
        # No doc attached or already summarized — skip
        return state

    logger.info(f"Analyzing existing policy: {doc_url[:60]}")
    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        from model import NomicEmbeddings

        parsed_docs = await parse_document_from_url(doc_url)
        small_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=50)
        small_chunks = small_splitter.split_documents(parsed_docs)
        embedding_model = NomicEmbeddings()
        small_db = await build_faiss_concurrent(small_chunks, embedding_model, batch_size=64, max_concurrent=3)
        retriever = small_db.as_retriever(search_kwargs={"k": 10})

        # Multi-pass retrieval for comprehensive summary
        queries = [
            "sum insured coverage amount premium benefits",
            "exclusions not covered waiting period limitation",
            "co-payment room rent sub-limit cap deductible",
            "maternity OPD ambulance ICU daycare",
        ]
        seen, unique_content = set(), []
        for q in queries:
            for doc in await asyncio.to_thread(retriever.invoke, q):
                if doc.page_content not in seen:
                    unique_content.append(doc.page_content)
                    seen.add(doc.page_content)

        context = "\n---\n".join(unique_content)[:5000]

        summary_prompt = f"""You are an insurance analyst. Summarize this policy in a structured comparison-ready format.

Policy Sections:
{context}

Provide a concise summary covering:
1. **Policy Name & Insurer**
2. **Sum Insured / Coverage Amount**
3. **Key Benefits** (room rent, ICU, ambulance, OPD, maternity, daycare)
4. **Sub-limits & Caps** (any limits per benefit)
5. **Co-payments / Deductibles**
6. **Waiting Periods** (pre-existing, specific diseases)
7. **Major Exclusions** (top 5 things NOT covered)
8. **Renewal Terms**

Be factual. Use the exact numbers from the document. If a field is not mentioned, say "Not specified".

Summary:"""

        response = await llm.ainvoke(summary_prompt)
        state["existing_policy_summary"] = clean_output(response)
        logger.info(f"Existing policy summary generated: {len(state['existing_policy_summary'])} chars")
    except Exception as e:
        logger.error(f"Failed to analyze existing policy: {e}")
        state["existing_policy_summary"] = "Could not analyze the uploaded policy."

    return state


async def robust_web_search(query: str, search_depth: str = "basic") -> List[str]:
    """
    Tries SerpApi Google AI Mode first, falls back to regular Google, then DuckDuckGo.
    Returns a list of snippet strings.
    """
    findings = []
    
    # 1. Try SerpApi Google AI Mode (Premium — synthesized answer + references)
    if SERP_API_KEY:
        try:
            logger.info(f"Using SerpApi Google AI Mode for: {query}")
            params = {
                "q": query,
                "api_key": SERP_API_KEY,
                "engine": "google_ai_mode",
            }
            search = await asyncio.to_thread(GoogleSearch, params)
            resultsBody = search.get_dict()

            # Extract the AI-synthesized markdown answer
            ai_markdown = resultsBody.get("reconstructed_markdown", "")
            if ai_markdown:
                findings.append(f"Source: Google AI Mode\nTitle: AI Overview\nSnippet: {ai_markdown[:3000]}")

            # Extract all references with links
            references = resultsBody.get("references", [])
            for ref in references[:5]:
                ref_text = f"Source: {ref.get('link', '')}\nTitle: {ref.get('title', '')}\nSnippet: {ref.get('snippet', '')}"
                findings.append(ref_text)

            if findings:
                logger.info(f"Google AI Mode returned {len(findings)} results")
                return findings
        except Exception as e:
            logger.warning(f"Google AI Mode failed, falling back to regular search: {e}")

    # 2. Fallback: Try SerpApi regular Google search
    if SERP_API_KEY:
        try:
            logger.info(f"Fallback: Using SerpApi regular Google for: {query}")
            params = {
                "q": query,
                "api_key": SERP_API_KEY,
                "engine": "google",
                "num": 5
            }
            search = await asyncio.to_thread(GoogleSearch, params)
            resultsBody = search.get_dict()
            
            # Knowledge Graph (High Quality)
            if "knowledge_graph" in resultsBody:
                kg = resultsBody["knowledge_graph"]
                kg_text = f"Source: {kg.get('source', {}).get('link', 'knowledge_graph')}\nTitle: Knowledge Graph\nSnippet: {kg.get('description', 'Insurance info')}"
                findings.append(kg_text)
            
            # Organic Results
            organic = resultsBody.get("organic_results", [])
            for r in organic[:3]:
                snippet = f"Source: {r.get('link')}\nTitle: {r.get('title')}\nSnippet: {r.get('snippet')}"
                
                # Handle Deep Crawl
                if search_depth == "deep":
                    try:
                        async with httpx.AsyncClient(timeout=8.0) as client:
                            resp = await client.get(r.get('link'), follow_redirects=True)
                            if resp.status_code == 200:
                                from bs4 import BeautifulSoup
                                soup = BeautifulSoup(resp.text, "html.parser")
                                text = soup.get_text(separator="\n")
                                clean_text = "\n".join(line.strip() for line in text.splitlines() if line.strip())[:2500]
                                snippet += f"\nDeep Content: {clean_text}"
                    except Exception as crawl_err:
                        logger.warning(f"Failed deep crawl for {r.get('link')}: {crawl_err}")
                
                findings.append(snippet)
            
            if findings:
                return findings
        except Exception as e:
            logger.error(f"SerpApi failed: {e}. Falling back to DuckDuckGo.")

    # 2. Fallback to DuckDuckGo/LiteSearch
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

    try:
        results = []
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
        
        if not results:
            results = await fallback_search(query)

        for r in results:
            snippet = f"Source: {r['href']}\nTitle: {r['title']}\nSnippet: {r['body']}"
            if search_depth == "deep" and r['href'] != "lite_search":
                try:
                    async with httpx.AsyncClient(timeout=8.0) as client:
                        resp = await client.get(r['href'], follow_redirects=True)
                        if resp.status_code == 200:
                            from bs4 import BeautifulSoup
                            soup = BeautifulSoup(resp.text, "html.parser")
                            text = soup.get_text(separator="\n")
                            clean_text = "\n".join(line.strip() for line in text.splitlines() if line.strip())[:2500]
                            snippet += f"\nDeep Content: {clean_text}"
                except Exception:
                    pass
            findings.append(snippet)
    except Exception as e:
        logger.error(f"DuckDuckGo failed for {query}: {e}")
        # One last try with lite search if DDGS crashed
        results = await fallback_search(query)
        for r in results:
            findings.append(f"Source: {r['href']}\nTitle: {r['title']}\nSnippet: {r['body']}")

    return findings


async def market_search_node(state: AgentState) -> AgentState:
    """Generates search queries and fetches real-time market data."""
    # 1. Generate Query strings
    chain = SEARCH_QUERY_PROMPT | llm
    try:
        response = await chain.ainvoke({
            "age": state.get("age") or "unknown",
            "family_size": state.get("family_size") or "unknown",
            "location": state.get("location") or "unknown",
            "goal": state.get("goal") or "unknown",
            "other_info": state.get("other_info") or "unknown"
        })

        raw = response.content if hasattr(response, "content") else response
        clean = raw.strip()
        if clean.startswith("```"):
            clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = "\n".join(clean.split("\n")[:-1])
        clean = clean.strip()

        parsed = json.loads(clean)
        if isinstance(parsed, dict) and "queries" in parsed:
            queries = parsed["queries"]
        elif isinstance(parsed, list):
            queries = parsed
        else:
            queries = list(parsed.values())[0] if parsed else []
        state["search_queries"] = [q for q in queries if isinstance(q, str)][:5]
    except Exception as e:
        logger.error(f"Failed to generate/parse search queries: {e}")
        fallback = f"{state.get('goal', 'insurance')} for {state.get('age', '')} year old in {state.get('location', 'India')} {state.get('family_size', '')}"
        state["search_queries"] = [fallback.strip()]

    # 2. Execute Search using robust helper
    market_findings = []
    depth = state.get("search_depth", "basic")
    
    # Process queries sequentially to avoid aggressive rate limits on fallbacks
    for query in state["search_queries"]:
        results = await robust_web_search(query, depth)
        market_findings.extend(results)

    state["market_context"] = market_findings
    return state


async def market_refine_node(state: AgentState) -> AgentState:
    """Uses LLM to filter and extract direct policy links from market data."""
    if not state.get("market_context"):
        state["refined_links"] = []
        return state

    chain = MARKET_REFINE_PROMPT | llm_json
    market_str = "\n---\n".join(state.get("market_context", []))
    
    try:
        response = await chain.ainvoke({
            "market_data": market_str[:10000], # Limit context
            "age": state.get("age") or "unknown",
            "family_size": state.get("family_size") or "unknown",
            "location": state.get("location") or "unknown",
            "goal": state.get("goal") or "unknown",
            "other_info": state.get("other_info") or "unknown"
        })
        data = json.loads(response.content if hasattr(response, "content") else response)
        state["refined_links"] = data.get("refined_links", [])
    except Exception as e:
        logger.error(f"Failed to refine links: {e}")
        state["refined_links"] = []
    
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
        "refined_links": json.dumps(state.get("refined_links", []), indent=2),
        "age": state.get("age") or "Not specified",
        "family_size": state.get("family_size") or "Not specified",
        "pre_existing_conditions": state.get("pre_existing_conditions") or "Not specified",
        "budget": state.get("budget") or "Not specified",
        "location": state.get("location") or "Not specified",
        "goal": state.get("goal") or "Not specified",
        "other_info": state.get("other_info") or "Not specified",
        "existing_policy_summary": state.get("existing_policy_summary") or "No existing policy provided."
    })

    state["final_recommendation"] = clean_output(response)
    state["recommendation_generated"] = True
    return state


def should_continue(state: AgentState):
    # If recommendation already exists and we have a conversational response for the chat, we stop.
    if state.get("recommendation_generated") and state.get("next_question"):
        return END

    if state.get("intake_complete"):
        # Route: if user has an existing policy that hasn't been summarized yet, analyze it first
        if state.get("has_existing_policy") == "yes" and state.get("documents") and not state.get("existing_policy_summary"):
            return "existing_policy_analysis_node"
        return "market_search_node"
    else:
        return END


# Compile Graph
graph_builder = StateGraph(AgentState)
graph_builder.add_node("information_gatherer_node", information_gatherer_node)
graph_builder.add_node("existing_policy_analysis_node", existing_policy_analysis_node)
graph_builder.add_node("market_search_node", market_search_node)
graph_builder.add_node("market_refine_node", market_refine_node)
graph_builder.add_node("policy_retriever_node", policy_retriever_node)
graph_builder.add_node("recommendation_node", recommendation_node)

graph_builder.add_edge(START, "information_gatherer_node")
graph_builder.add_conditional_edges("information_gatherer_node", should_continue)
graph_builder.add_edge("existing_policy_analysis_node", "market_search_node")
graph_builder.add_edge("market_search_node", "market_refine_node")
graph_builder.add_edge("market_refine_node", "policy_retriever_node")
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
        "has_existing_policy": pick("has_existing_policy"),
        "other_info": pick("other_info"),
        "existing_policy_summary": prev.get("existing_policy_summary"),
        "search_depth": req.search_depth or prev.get("search_depth", "basic"),
        "documents": pick("documents"),
        "auth_token": Authorization,
        "intake_complete": prev.get("intake_complete", False),
        "retrieved_policies": [],
        "market_context": prev.get("market_context", []),
        "search_queries": [],
        "final_recommendation": prev.get("final_recommendation", ""),
        "next_question": "",
        "refined_links": prev.get("refined_links", []),
        "recommendation_generated": prev.get("recommendation_generated", False)
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
            "has_existing_policy": final_state.get("has_existing_policy"),
            "other_info": final_state.get("other_info"),
            "existing_policy_summary": final_state.get("existing_policy_summary"),
            "search_depth": final_state.get("search_depth", "basic"),
            "documents": final_state.get("documents"),
            "chat_history": final_state.get("chat_history", []),
            "next_question": final_state.get("next_question", ""),
            "recommendation_generated": final_state.get("recommendation_generated", False),
            "final_recommendation": final_state.get("final_recommendation", ""),
            "market_context": final_state.get("market_context", []),
            "refined_links": final_state.get("refined_links", []),
            "intake_complete": final_state.get("intake_complete", False),
        }

        # ---- Build frontend-friendly response ----
        profile_fields = ["age", "family_size", "pre_existing_conditions", "budget", "location", "goal", "other_info"]
        extracted_profile = {k: final_state.get(k) for k in profile_fields if final_state.get(k)}

        return {
            "next_question": final_state.get("next_question", ""),
            "intake_complete": final_state.get("intake_complete", False),
            "final_recommendation": final_state.get("final_recommendation", ""),
            "market_context": final_state.get("market_context", []),
            "refined_links": final_state.get("refined_links", []),
            "extracted_profile": extracted_profile,
            "existing_policy_summary": final_state.get("existing_policy_summary", ""),
        }
    except Exception as e:
        logger.exception("Agent graph failed")
        raise HTTPException(status_code=500, detail=str(e))
