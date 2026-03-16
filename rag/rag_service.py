"""
Gray's WMS RAG Service
----------------------
Flask service (pure Python — works on Python 3.14+, no Rust required):
  1. Ingests trip/order data from Oracle APEX into ChromaDB
  2. Answers natural-language questions using Claude + RAG

Run:  python rag_service.py
      → starts at http://127.0.0.1:8765
"""

import os
import json
import threading
import requests
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
import chromadb
from sentence_transformers import SentenceTransformer
import anthropic

# ─────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────
APEX_BASE      = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP"
TRIPS_ENDPOINT = f"{APEX_BASE}/WAREHOUSEMANAGEMENT/GETTRIPDETAILS"
CHROMA_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")
COLLECTION_NAME = "wms_trips"
EMBED_MODEL    = "all-MiniLM-L6-v2"   # ~80 MB, fully offline

# ─────────────────────────────────────────────
#  Flask app
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app)   # allow all origins (WebView2 localhost calls)

# ─────────────────────────────────────────────
#  Shared sync state
# ─────────────────────────────────────────────
sync_state = {
    "running":    False,
    "total_days": 0,
    "done_days":  0,
    "total_docs": 0,
    "current_date": "",
    "errors":     [],
    "finished":   False,
    "started_at": None,
}

# ─────────────────────────────────────────────
#  Lazy-loaded singletons
# ─────────────────────────────────────────────
_embedder        = None
_chroma_client   = None
_collection      = None


def get_embedder():
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


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def date_to_apex(d):
    return d.strftime("%d-%m-%Y")


def fetch_trips_for_date(date, instance="PROD"):
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


def build_document(row):
    def g(*keys):
        for k in keys:
            v = row.get(k) or row.get(k.lower())
            if v:
                return str(v)
        return ""

    trip_id      = g("TRIP_ID")
    trip_date    = g("TRIP_DATE")
    order_number = g("ORDER_NUMBER")
    customer     = g("ACCOUNT_NAME", "CUSTOMER_NAME")
    picker       = g("PICKER", "PICKER_NAME")
    status       = g("LINE_STATUS", "STATUS")
    priority     = g("TRIP_PRIORITY", "PRIORITY")
    vehicle      = g("LORRY_NUMBER", "TRIP_LORRY")
    product      = g("PRODUCT_NAME", "ITEM_NAME")
    quantity     = g("QUANTITY")
    weight       = g("WEIGHT")
    loading_bay  = g("LOADING_BAY")
    order_type   = g("ORDER_TYPE_CODE", "ORDER_TYPE")

    doc_id = f"{trip_id}_{order_number}_{trip_date}".replace("/", "-").replace(" ", "_")

    text = (
        f"Trip ID: {trip_id}\n"
        f"Trip Date: {trip_date}\n"
        f"Order Number: {order_number}\n"
        f"Customer: {customer}\n"
        f"Picker: {picker}\n"
        f"Status: {status}\n"
        f"Priority: {priority}\n"
        f"Vehicle: {vehicle}\n"
        f"Product: {product}\n"
        f"Quantity: {quantity}\n"
        f"Weight: {weight}\n"
        f"Loading Bay: {loading_bay}\n"
        f"Order Type: {order_type}"
    )

    metadata = {
        "trip_id": trip_id, "trip_date": trip_date,
        "order_number": order_number, "customer": customer,
        "picker": picker, "status": status,
        "priority": priority, "vehicle": vehicle,
    }
    return doc_id, text, metadata


def embed_texts(texts):
    return get_embedder().encode(texts, show_progress_bar=False).tolist()


def do_sync(date_from, date_to, instance):
    sync_state.update({
        "running": True, "finished": False, "errors": [],
        "total_docs": 0, "done_days": 0,
        "started_at": datetime.now().isoformat(),
        "total_days": (date_to - date_from).days + 1,
    })

    collection = get_collection()
    current = date_from
    while current <= date_to and sync_state["running"]:
        sync_state["current_date"] = date_to_apex(current)
        rows = fetch_trips_for_date(current, instance)

        if rows:
            docs, ids, metas = [], [], []
            for row in rows:
                doc_id, text, meta = build_document(row)
                docs.append(text)
                ids.append(doc_id)
                metas.append(meta)
            embeddings = embed_texts(docs)
            collection.upsert(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)
            sync_state["total_docs"] += len(docs)

        sync_state["done_days"] += 1
        current += timedelta(days=1)

    sync_state["running"]  = False
    sync_state["finished"] = True


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────
@app.get("/status")
def status():
    try:
        doc_count = get_collection().count()
    except Exception:
        doc_count = 0
    return jsonify({"running": True, "collection": COLLECTION_NAME,
                    "documents_in_db": doc_count, "sync": sync_state})


@app.post("/sync")
def sync():
    if sync_state["running"]:
        return jsonify({"success": False, "message": "Sync already in progress"})

    body = request.get_json(silent=True) or {}
    date_from_str = body.get("date_from", "")
    date_to_str   = body.get("date_to", "")
    instance      = body.get("instance", "PROD")

    try:
        d_from = datetime.strptime(date_from_str, "%d-%m-%Y")
        d_to   = datetime.strptime(date_to_str,   "%d-%m-%Y")
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date format. Use DD-MM-YYYY"})

    if d_from > d_to:
        return jsonify({"success": False, "message": "date_from must be <= date_to"})

    t = threading.Thread(target=do_sync, args=(d_from, d_to, instance), daemon=True)
    t.start()
    return jsonify({"success": True, "message": f"Sync started for {date_from_str} → {date_to_str}"})


@app.get("/sync/progress")
def sync_progress():
    pct = 0
    if sync_state["total_days"] > 0:
        pct = round((sync_state["done_days"] / sync_state["total_days"]) * 100)
    return jsonify({**sync_state, "percent": pct})


@app.post("/sync/cancel")
def sync_cancel():
    sync_state["running"]  = False
    sync_state["finished"] = True
    return jsonify({"success": True})


@app.delete("/collection")
def clear_collection():
    global _collection
    try:
        get_collection()
        _chroma_client.delete_collection(COLLECTION_NAME)
        _collection = None
        get_collection()
        return jsonify({"success": True, "message": "Collection cleared"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.post("/query")
def query():
    body = request.get_json(silent=True) or {}
    question      = body.get("question", "").strip()
    top_k         = int(body.get("top_k", 8))
    claude_api_key = body.get("claude_api_key") or os.environ.get("CLAUDE_API_KEY", "")

    if not question:
        return jsonify({"success": False, "answer": "No question provided.", "sources": []})

    try:
        col = get_collection()
        if col.count() == 0:
            return jsonify({"success": False,
                            "answer": "No data synced yet. Please sync WMS data first.",
                            "sources": []})

        q_embedding = embed_texts([question])[0]
        results = col.query(
            query_embeddings=[q_embedding],
            n_results=min(top_k, col.count()),
            include=["documents", "metadatas", "distances"],
        )

        docs      = results["documents"][0]
        metas     = results["metadatas"][0]
        distances = results["distances"][0]

        context_blocks = []
        for i, (doc, dist) in enumerate(zip(docs, distances)):
            relevance = round((1 - dist) * 100, 1)
            context_blocks.append(f"[Record {i+1} | Relevance: {relevance}%]\n{doc}")
        context = "\n\n".join(context_blocks)

        system_prompt = (
            "You are a WMS data analyst for Gray's WMS. "
            "Answer questions about trips, orders, pickers, vehicles, and deliveries. "
            "Use ONLY the provided context records. Be concise and factual. "
            "If context is insufficient, say so. Use bullet points where helpful."
        )
        user_prompt = f"Context from WMS database:\n\n{context}\n\nQuestion: {question}\n\nAnswer:"

        client = anthropic.Anthropic(api_key=claude_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": user_prompt}],
            system=system_prompt,
        )
        answer = message.content[0].text

        sources, seen = [], set()
        for meta in metas:
            key = f"{meta.get('trip_id')}_{meta.get('order_number')}"
            if key not in seen:
                seen.add(key)
                sources.append({k: meta.get(k, "") for k in
                                 ("trip_id", "order_number", "trip_date", "customer", "picker", "status")})

        return jsonify({"success": True, "answer": answer, "sources": sources})

    except Exception as e:
        return jsonify({"success": False, "answer": f"Error: {str(e)}", "sources": []})


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("WMS RAG Service starting on http://127.0.0.1:8765")
    app.run(host="127.0.0.1", port=8765, debug=False, threaded=True)
