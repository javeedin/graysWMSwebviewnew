"""
Gray's WMS RAG Service
----------------------
FastAPI service that:
  1. Ingests trip/order data from Oracle APEX into ChromaDB
  2. Answers natural-language questions about WMS data using Claude + RAG

Run:  uvicorn rag_service:app --host 127.0.0.1 --port 8765 --reload
Dist: pyinstaller --onefile rag_service.py
"""

import os
import json
import time
import asyncio
import threading
import requests
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import anthropic

# ─────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────
APEX_BASE = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP"
TRIPS_ENDPOINT = f"{APEX_BASE}/WAREHOUSEMANAGEMENT/GETTRIPDETAILS"
CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY", "")
COLLECTION_NAME = "wms_trips"
EMBED_MODEL = "all-MiniLM-L6-v2"   # ~80MB, runs fully offline

# ─────────────────────────────────────────────
#  App & CORS (allow WebView2 localhost calls)
# ─────────────────────────────────────────────
app = FastAPI(title="WMS RAG Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
#  Shared sync state (for progress streaming)
# ─────────────────────────────────────────────
sync_state = {
    "running": False,
    "total_days": 0,
    "done_days": 0,
    "total_docs": 0,
    "current_date": "",
    "errors": [],
    "finished": False,
    "started_at": None,
}

# ─────────────────────────────────────────────
#  Lazy-loaded singletons
# ─────────────────────────────────────────────
_embedder: Optional[SentenceTransformer] = None
_chroma_client: Optional[chromadb.PersistentClient] = None
_collection = None
_claude_client: Optional[anthropic.Anthropic] = None


def get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(EMBED_MODEL)
    return _embedder


def get_collection():
    global _chroma_client, _collection
    if _chroma_client is None:
        os.makedirs(CHROMA_DIR, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
    if _collection is None:
        _collection = _chroma_client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def get_claude() -> anthropic.Anthropic:
    global _claude_client
    if _claude_client is None:
        key = CLAUDE_API_KEY or os.environ.get("CLAUDE_API_KEY", "")
        if not key:
            raise RuntimeError("CLAUDE_API_KEY not set")
        _claude_client = anthropic.Anthropic(api_key=key)
    return _claude_client


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def date_to_apex(d: datetime) -> str:
    """DD-MM-YYYY as required by APEX endpoint."""
    return d.strftime("%d-%m-%Y")


def fetch_trips_for_date(date: datetime, instance: str = "PROD") -> List[dict]:
    """Fetch all trip/order rows for a single day from APEX."""
    ds = date_to_apex(date)
    params = {"P_DATE_FROM": ds, "P_DATE_TO": ds, "P_INSTANCE_NAME": instance}
    try:
        resp = requests.get(TRIPS_ENDPOINT, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("items", data.get("data", []))
    except Exception as e:
        sync_state["errors"].append(f"{ds}: {str(e)}")
    return []


def build_document(row: dict) -> tuple[str, str, dict]:
    """
    Convert one APEX row into (doc_id, text_chunk, metadata).
    Text is structured so the embedder can match natural language queries.
    """
    trip_id      = str(row.get("TRIP_ID") or row.get("trip_id") or "")
    trip_date    = str(row.get("TRIP_DATE") or row.get("trip_date") or "")
    order_number = str(row.get("ORDER_NUMBER") or row.get("order_number") or "")
    customer     = str(row.get("ACCOUNT_NAME") or row.get("account_name") or
                       row.get("CUSTOMER_NAME") or row.get("customer_name") or "")
    picker       = str(row.get("PICKER") or row.get("picker") or
                       row.get("PICKER_NAME") or row.get("picker_name") or "")
    status       = str(row.get("LINE_STATUS") or row.get("line_status") or
                       row.get("STATUS") or row.get("status") or "")
    priority     = str(row.get("TRIP_PRIORITY") or row.get("trip_priority") or
                       row.get("PRIORITY") or row.get("priority") or "")
    vehicle      = str(row.get("LORRY_NUMBER") or row.get("lorry_number") or
                       row.get("TRIP_LORRY") or row.get("trip_lorry") or "")
    product      = str(row.get("PRODUCT_NAME") or row.get("product_name") or
                       row.get("ITEM_NAME") or row.get("item_name") or "")
    quantity     = str(row.get("QUANTITY") or row.get("quantity") or "")
    weight       = str(row.get("WEIGHT") or row.get("weight") or "")
    loading_bay  = str(row.get("LOADING_BAY") or row.get("loading_bay") or "")
    order_type   = str(row.get("ORDER_TYPE_CODE") or row.get("order_type_code") or
                       row.get("ORDER_TYPE") or row.get("order_type") or "")

    doc_id = f"{trip_id}_{order_number}_{trip_date}".replace("/", "-").replace(" ", "_")

    text = f"""Trip ID: {trip_id}
Trip Date: {trip_date}
Order Number: {order_number}
Customer: {customer}
Picker: {picker}
Status: {status}
Priority: {priority}
Vehicle: {vehicle}
Product: {product}
Quantity: {quantity}
Weight: {weight}
Loading Bay: {loading_bay}
Order Type: {order_type}"""

    metadata = {
        "trip_id": trip_id,
        "trip_date": trip_date,
        "order_number": order_number,
        "customer": customer,
        "picker": picker,
        "status": status,
        "priority": priority,
        "vehicle": vehicle,
    }

    return doc_id, text, metadata


def embed_texts(texts: List[str]) -> List[List[float]]:
    return get_embedder().encode(texts, show_progress_bar=False).tolist()


def do_sync(date_from: datetime, date_to: datetime, instance: str):
    """Background thread: iterate dates, fetch APEX, embed, upsert into ChromaDB."""
    sync_state.update({
        "running": True,
        "finished": False,
        "errors": [],
        "total_docs": 0,
        "done_days": 0,
        "started_at": datetime.now().isoformat(),
    })

    delta = (date_to - date_from).days + 1
    sync_state["total_days"] = delta
    collection = get_collection()

    current = date_from
    while current <= date_to:
        sync_state["current_date"] = date_to_apex(current)
        rows = fetch_trips_for_date(current, instance)

        if rows:
            docs, ids, metas = [], [], []
            for row in rows:
                doc_id, text, meta = build_document(row)
                docs.append(text)
                ids.append(doc_id)
                metas.append(meta)

            # Embed in one batch
            embeddings = embed_texts(docs)

            # Upsert (safe to re-run — same IDs overwrite)
            collection.upsert(
                ids=ids,
                documents=docs,
                embeddings=embeddings,
                metadatas=metas,
            )
            sync_state["total_docs"] += len(docs)

        sync_state["done_days"] += 1
        current += timedelta(days=1)

    sync_state["running"] = False
    sync_state["finished"] = True


# ─────────────────────────────────────────────
#  Request / Response models
# ─────────────────────────────────────────────
class SyncRequest(BaseModel):
    date_from: str        # DD-MM-YYYY
    date_to: str          # DD-MM-YYYY
    instance: str = "PROD"


class QueryRequest(BaseModel):
    question: str
    top_k: int = 8
    instance: Optional[str] = None
    claude_api_key: Optional[str] = None


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────
@app.get("/status")
def status():
    try:
        col = get_collection()
        doc_count = col.count()
    except Exception:
        doc_count = 0
    return {
        "running": True,
        "collection": COLLECTION_NAME,
        "documents_in_db": doc_count,
        "sync": sync_state,
    }


@app.post("/sync")
def sync(req: SyncRequest, background_tasks: BackgroundTasks):
    if sync_state["running"]:
        return {"success": False, "message": "Sync already in progress"}

    try:
        d_from = datetime.strptime(req.date_from, "%d-%m-%Y")
        d_to   = datetime.strptime(req.date_to,   "%d-%m-%Y")
    except ValueError:
        return {"success": False, "message": "Invalid date format. Use DD-MM-YYYY"}

    if d_from > d_to:
        return {"success": False, "message": "date_from must be <= date_to"}

    background_tasks.add_task(do_sync, d_from, d_to, req.instance)
    return {"success": True, "message": f"Sync started for {req.date_from} → {req.date_to}"}


@app.get("/sync/progress")
def sync_progress():
    pct = 0
    if sync_state["total_days"] > 0:
        pct = round((sync_state["done_days"] / sync_state["total_days"]) * 100)
    return {**sync_state, "percent": pct}


@app.post("/sync/cancel")
def sync_cancel():
    """Best-effort cancel — sets flag; running thread checks it."""
    sync_state["running"] = False
    sync_state["finished"] = True
    return {"success": True}


@app.delete("/collection")
def clear_collection():
    """Wipe the entire ChromaDB collection (start fresh)."""
    global _collection
    try:
        client = get_collection()  # ensure client exists
        _chroma_client.delete_collection(COLLECTION_NAME)
        _collection = None
        get_collection()  # recreate
        return {"success": True, "message": "Collection cleared"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/query")
def query(req: QueryRequest):
    try:
        col = get_collection()
        if col.count() == 0:
            return {
                "success": False,
                "answer": "No data synced yet. Please sync WMS data first.",
                "sources": [],
            }

        # Embed the question
        q_embedding = embed_texts([req.question])[0]

        # Retrieve top-k relevant chunks
        results = col.query(
            query_embeddings=[q_embedding],
            n_results=min(req.top_k, col.count()),
            include=["documents", "metadatas", "distances"],
        )

        docs      = results["documents"][0]
        metas     = results["metadatas"][0]
        distances = results["distances"][0]

        # Build context for Claude
        context_blocks = []
        for i, (doc, dist) in enumerate(zip(docs, distances)):
            relevance = round((1 - dist) * 100, 1)
            context_blocks.append(f"[Record {i+1} | Relevance: {relevance}%]\n{doc}")

        context = "\n\n".join(context_blocks)

        system_prompt = """You are a WMS (Warehouse Management System) data analyst for Gray's WMS.
You answer questions about trips, orders, pickers, vehicles, and delivery data.
Use ONLY the provided context records to answer. Be concise and factual.
If the context doesn't contain enough information, say so clearly.
Format numbers, dates, and lists clearly. Use bullet points where helpful."""

        user_prompt = f"""Context from WMS database:

{context}

Question: {req.question}

Answer based on the context above:"""

        # Use provided key or fall back to env
        api_key = req.claude_api_key or CLAUDE_API_KEY or os.environ.get("CLAUDE_API_KEY", "")
        client = anthropic.Anthropic(api_key=api_key)

        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": user_prompt}],
            system=system_prompt,
        )

        answer = message.content[0].text

        # Build source citations
        sources = []
        seen = set()
        for meta in metas:
            key = f"{meta.get('trip_id')}_{meta.get('order_number')}"
            if key not in seen:
                seen.add(key)
                sources.append({
                    "trip_id":      meta.get("trip_id", ""),
                    "order_number": meta.get("order_number", ""),
                    "trip_date":    meta.get("trip_date", ""),
                    "customer":     meta.get("customer", ""),
                    "picker":       meta.get("picker", ""),
                    "status":       meta.get("status", ""),
                })

        return {"success": True, "answer": answer, "sources": sources}

    except Exception as e:
        return {"success": False, "answer": f"Error: {str(e)}", "sources": []}


# ─────────────────────────────────────────────
#  Entry point (for PyInstaller / direct run)
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
