"""
Gray's WMS RAG Service
----------------------
Flask service — works on Python 3.14+, zero C++/Rust compilation required:
  • Flask          — pure Python web server
  • fastembed      — ONNX-based embeddings (no torch, no Rust)
  • numpy          — has cp314 binary wheels
  • SimpleVectorStore — replaces chromadb (numpy + JSON, no chroma-hnswlib)

Run:  python rag_service.py
      → http://127.0.0.1:8765
"""

import os
import sys
import json
import logging
import threading
import requests
import numpy as np
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from fastembed import TextEmbedding
import anthropic
try:
    import openai as _openai_mod
except ImportError:
    _openai_mod = None

# ─────────────────────────────────────────────
#  Logging — console + file (C:\fusion\rag_service.log)
# ─────────────────────────────────────────────
LOG_DIR  = r"C:\fusion"
LOG_FILE = os.path.join(LOG_DIR, "rag_service.log")

os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),                       # console window
        logging.FileHandler(LOG_FILE, encoding="utf-8"),         # C:\fusion\rag_service.log
    ],
)
log = logging.getLogger("rag")


def banner(msg):
    """Print a highlighted section header."""
    log.info("=" * 55)
    log.info(f"  {msg}")
    log.info("=" * 55)

# ─────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────
APEX_BASE       = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP"
TRIPS_ENDPOINT  = f"{APEX_BASE}/WAREHOUSEMANAGEMENT/GETTRIPDETAILS"
DETAIL_ENDPOINT = f"{APEX_BASE}/WAREHOUSEMANAGEMENT/GETTRIPDETAILS"  # + /{trip_id}
STORE_DIR       = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vector_db")
EMBED_MODEL     = "BAAI/bge-small-en-v1.5"   # ~130 MB ONNX model, fully offline

# ─────────────────────────────────────────────
#  Flask app
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins="*", supports_credentials=False)

@app.after_request
def add_cors_private_network(response):
    """Allow WebView2 (file:// context) to reach this local service.
    Chrome/WebView2 Private Network Access policy requires this header."""
    response.headers["Access-Control-Allow-Origin"]          = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Methods"]         = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"]         = "Content-Type"
    return response

@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def handle_preflight(path):
    """Handle CORS preflight (OPTIONS) for Private Network Access."""
    response = app.make_default_options_response()
    response.headers["Access-Control-Allow-Origin"]          = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Methods"]         = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"]         = "Content-Type"
    return response

# ─────────────────────────────────────────────
#  Sync state
# ─────────────────────────────────────────────
sync_state = {
    "running": False, "total_days": 0, "done_days": 0,
    "total_docs": 0, "current_date": "", "errors": [],
    "finished": False, "started_at": None,
}

# ─────────────────────────────────────────────
#  SimpleVectorStore  (replaces chromadb)
#  Persists embeddings as .npy + metadata as JSON.
#  Cosine similarity search via numpy — no C++ needed.
# ─────────────────────────────────────────────
class SimpleVectorStore:
    def __init__(self, path):
        self.path       = path
        self._emb_file  = os.path.join(path, "embeddings.npy")
        self._data_file = os.path.join(path, "data.json")
        self._ids, self._docs, self._metas, self._embs = [], [], [], None
        self._load()

    def _load(self):
        if os.path.exists(self._data_file):
            with open(self._data_file, encoding="utf-8") as f:
                d = json.load(f)
            self._ids   = d["ids"]
            self._docs  = d["documents"]
            self._metas = d["metadatas"]
        if os.path.exists(self._emb_file) and self._ids:
            self._embs = np.load(self._emb_file)

    def _save(self):
        os.makedirs(self.path, exist_ok=True)
        with open(self._data_file, "w", encoding="utf-8") as f:
            json.dump({"ids": self._ids, "documents": self._docs,
                       "metadatas": self._metas}, f)
        if self._embs is not None:
            np.save(self._emb_file, self._embs)

    def count(self):
        return len(self._ids)

    def upsert(self, ids, documents, embeddings, metadatas):
        new_embs = np.array(embeddings, dtype=np.float32)
        id_set   = set(ids)
        keep     = [i for i, id_ in enumerate(self._ids) if id_ not in id_set]

        if keep and self._embs is not None:
            kept_embs  = self._embs[keep]
            kept_ids   = [self._ids[i]   for i in keep]
            kept_docs  = [self._docs[i]  for i in keep]
            kept_metas = [self._metas[i] for i in keep]
        else:
            kept_embs  = np.zeros((0, new_embs.shape[1]), dtype=np.float32)
            kept_ids, kept_docs, kept_metas = [], [], []

        self._embs  = np.vstack([kept_embs, new_embs]) if len(kept_ids) else new_embs
        self._ids   = kept_ids   + list(ids)
        self._docs  = kept_docs  + list(documents)
        self._metas = kept_metas + list(metadatas)
        self._save()

    def query(self, query_embeddings, n_results=8, **_):
        empty = {"documents": [[]], "metadatas": [[]], "distances": [[]]}
        if not self._ids or self._embs is None:
            return empty

        q      = np.array(query_embeddings[0], dtype=np.float32)
        norm_q = np.linalg.norm(q)
        norm_e = np.linalg.norm(self._embs, axis=1)
        denom  = np.where(norm_e * norm_q == 0, 1e-10, norm_e * norm_q)
        dists  = (1.0 - self._embs.dot(q) / denom).tolist()

        n      = min(n_results, len(self._ids))
        top    = sorted(range(len(dists)), key=lambda i: dists[i])[:n]
        return {
            "documents": [[self._docs[i]  for i in top]],
            "metadatas": [[self._metas[i] for i in top]],
            "distances": [[dists[i]       for i in top]],
        }

    def clear(self):
        self._ids, self._docs, self._metas, self._embs = [], [], [], None
        for p in (self._emb_file, self._data_file):
            if os.path.exists(p):
                os.remove(p)


# ─────────────────────────────────────────────
#  Lazy-loaded singletons
# ─────────────────────────────────────────────
_embedder = None
_store    = None


def get_embedder():
    global _embedder
    if _embedder is None:
        log.info(f"Loading embedding model: {EMBED_MODEL}")
        log.info("(First run downloads ~130 MB — please wait...)")
        try:
            _embedder = TextEmbedding(EMBED_MODEL)
            log.info("Embedding model loaded OK")
        except Exception as e:
            log.error(f"FAILED to load embedding model: {e}")
            raise
    return _embedder


def get_store():
    global _store
    if _store is None:
        os.makedirs(STORE_DIR, exist_ok=True)
        _store = SimpleVectorStore(STORE_DIR)
        log.info(f"Vector store ready — {_store.count()} documents  ({STORE_DIR})")
    return _store


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
    except requests.exceptions.ConnectionError as e:
        msg = f"{ds}: Cannot reach APEX — check internet connection. {e}"
        log.error(msg); sync_state["errors"].append(msg)
    except requests.exceptions.Timeout:
        msg = f"{ds}: APEX request timed out (60s)"
        log.error(msg); sync_state["errors"].append(msg)
    except Exception as e:
        msg = f"{ds}: {str(e)}"
        log.error(msg); sync_state["errors"].append(msg)
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
        f"Trip ID: {trip_id}\nTrip Date: {trip_date}\nOrder Number: {order_number}\n"
        f"Customer: {customer}\nPicker: {picker}\nStatus: {status}\n"
        f"Priority: {priority}\nVehicle: {vehicle}\nProduct: {product}\n"
        f"Quantity: {quantity}\nWeight: {weight}\nLoading Bay: {loading_bay}\n"
        f"Order Type: {order_type}"
    )
    metadata = {
        "trip_id": trip_id, "trip_date": trip_date, "order_number": order_number,
        "customer": customer, "picker": picker, "status": status,
        "priority": priority, "vehicle": vehicle,
    }
    return doc_id, text, metadata


def fetch_trip_detail(trip_id, instance="PROD"):
    """Fetch per-order-line detail for one trip via GETTRIPDETAILS/{tripId}."""
    url    = f"{DETAIL_ENDPOINT}/{trip_id}"
    params = {"P_INSTANCE_NAME": instance}
    try:
        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("items", data.get("data", []))
    except Exception as e:
        log.warning(f"Trip detail fetch failed for {trip_id}: {e}")
        sync_state["errors"].append(f"Detail fetch failed — Trip {trip_id}: {e}")
    return []


def embed_texts(texts):
    """Returns list of lists (fastembed yields numpy arrays)."""
    return [emb.tolist() for emb in get_embedder().embed(texts)]


def do_sync(date_from, date_to, instance, include_details=False):
    total_days = (date_to - date_from).days + 1
    sync_state.update({
        "running": True, "finished": False, "errors": [],
        "total_docs": 0, "done_days": 0,
        "started_at": datetime.now().isoformat(),
        "total_days": total_days,
        "include_details": include_details,
    })
    log.info(f"Sync started — {date_to_apex(date_from)} → {date_to_apex(date_to)} "
             f"({total_days} days, instance={instance}, details={include_details})")
    store   = get_store()
    current = date_from
    while current <= date_to and sync_state["running"]:
        ds = date_to_apex(current)
        sync_state["current_date"] = ds
        header_rows = fetch_trips_for_date(current, instance)

        if not header_rows:
            log.info(f"  {ds} — no records")
            sync_state["done_days"] += 1
            current += timedelta(days=1)
            continue

        if include_details:
            # Collect unique trip IDs then fetch their order-line details
            seen_trips = dict.fromkeys(
                str(r.get("TRIP_ID") or r.get("trip_id") or "").strip()
                for r in header_rows
            )
            seen_trips.pop("", None)
            rows_to_index = []
            for trip_id in seen_trips:
                detail = fetch_trip_detail(trip_id, instance)
                if detail:
                    rows_to_index.extend(detail)
                else:
                    # fall back: use header rows for this trip
                    rows_to_index.extend(
                        r for r in header_rows
                        if str(r.get("TRIP_ID") or r.get("trip_id") or "").strip() == trip_id
                    )
        else:
            rows_to_index = header_rows

        docs, ids, metas = [], [], []
        for row in rows_to_index:
            doc_id, text, meta = build_document(row)
            if doc_id:
                docs.append(text); ids.append(doc_id); metas.append(meta)

        if docs:
            store.upsert(ids=ids, documents=docs,
                         embeddings=embed_texts(docs), metadatas=metas)
            sync_state["total_docs"] += len(docs)
            log.info(f"  {ds} — {len(docs)} records synced (total so far: {sync_state['total_docs']})")

        sync_state["done_days"] += 1
        current += timedelta(days=1)

    if sync_state["errors"]:
        log.warning(f"Sync finished with {len(sync_state['errors'])} error(s):")
        for err in sync_state["errors"]:
            log.warning(f"  {err}")
    else:
        log.info(f"Sync complete — {sync_state['total_docs']} total documents in vector store")

    sync_state["running"]  = False
    sync_state["finished"] = True


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────
@app.get("/browse")
def browse():
    """Return a paginated list of all records stored in the vector DB."""
    try:
        page     = max(1, int(request.args.get("page",     1)))
        per_page = max(1, min(100, int(request.args.get("per_page", 25))))
        store    = get_store()
        total    = store.count()
        start    = (page - 1) * per_page
        end      = min(start + per_page, total)
        records  = [
            {"id": store._ids[i], "metadata": store._metas[i]}
            for i in range(start, end)
        ]
        return jsonify({
            "total":    total,
            "page":     page,
            "per_page": per_page,
            "pages":    max(1, (total + per_page - 1) // per_page),
            "records":  records,
        })
    except Exception as e:
        return jsonify({"total": 0, "page": 1, "per_page": 25, "pages": 1,
                        "records": [], "error": str(e)})


@app.get("/status")
def status():
    try:
        doc_count = get_store().count()
    except Exception:
        doc_count = 0
    return jsonify({"running": True, "collection": "wms_trips",
                    "documents_in_db": doc_count, "sync": sync_state})


@app.post("/sync")
def sync():
    if sync_state["running"]:
        return jsonify({"success": False, "message": "Sync already in progress"})
    body          = request.get_json(silent=True) or {}
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
    include_details = bool(body.get("include_details", False))
    threading.Thread(target=do_sync,
                     args=(d_from, d_to, instance, include_details), daemon=True).start()
    return jsonify({"success": True,
                    "message": f"Sync started for {date_from_str} → {date_to_str}",
                    "include_details": include_details})


@app.get("/sync/progress")
def sync_progress():
    pct = round((sync_state["done_days"] / sync_state["total_days"]) * 100) \
          if sync_state["total_days"] > 0 else 0
    return jsonify({**sync_state, "percent": pct})


@app.get("/preview")
def preview():
    """
    Fetch raw APEX data for a given date — no indexing.
    Shows what fields the API returns and up to 5 sample records.
    If include_details=true, also fetches order-line detail for the first trip.
    """
    date_str        = request.args.get("date_from", "")
    instance        = request.args.get("instance", "PROD")
    include_details = request.args.get("include_details", "false").lower() == "true"

    if not date_str:
        return jsonify({"error": "date_from is required (DD-MM-YYYY)"})
    try:
        d = datetime.strptime(date_str, "%d-%m-%Y")
    except ValueError:
        return jsonify({"error": "Invalid date. Use DD-MM-YYYY"})

    try:
        header_rows = fetch_trips_for_date(d, instance)
    except Exception as e:
        return jsonify({"error": str(e)})

    result = {
        "date":           date_str,
        "instance":       instance,
        "header_count":   len(header_rows),
        "header_fields":  list(header_rows[0].keys()) if header_rows else [],
        "header_sample":  header_rows[:5],
        "detail_sample":  [],
        "detail_fields":  [],
        "detail_count":   0,
    }

    if include_details and header_rows:
        first_trip = str(header_rows[0].get("TRIP_ID") or
                         header_rows[0].get("trip_id") or "").strip()
        if first_trip:
            detail_rows = fetch_trip_detail(first_trip, instance)
            result["detail_count"]  = len(detail_rows)
            result["detail_fields"] = list(detail_rows[0].keys()) if detail_rows else []
            result["detail_sample"] = detail_rows[:5]

    return jsonify(result)


@app.post("/sync/cancel")
def sync_cancel():
    sync_state["running"]  = False
    sync_state["finished"] = True
    return jsonify({"success": True})


@app.delete("/collection")
def clear_collection():
    global _store
    try:
        get_store().clear()
        _store = None
        get_store()
        return jsonify({"success": True, "message": "Collection cleared"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@app.post("/query")
def query():
    body           = request.get_json(silent=True) or {}
    question       = body.get("question", "").strip()
    top_k          = int(body.get("top_k", 8))
    llm_provider   = body.get("llm_provider", "claude").lower()  # "claude" or "openai"
    claude_api_key = body.get("claude_api_key") or os.environ.get("CLAUDE_API_KEY", "")
    openai_api_key = body.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    openai_model   = body.get("openai_model", "gpt-4o-mini")

    if not question:
        return jsonify({"success": False, "answer": "No question provided.", "sources": []})

    log.info(f"Query [{llm_provider}]: {question[:80]}")
    try:
        store = get_store()
        if store.count() == 0:
            return jsonify({"success": False,
                            "answer": "No data synced yet. Please sync WMS data first.",
                            "sources": []})

        q_embedding = embed_texts([question])[0]
        results     = store.query(query_embeddings=[q_embedding],
                                  n_results=min(top_k, store.count()))

        docs      = results["documents"][0]
        metas     = results["metadatas"][0]
        distances = results["distances"][0]

        context = "\n\n".join(
            f"[Record {i+1} | Relevance: {round((1-d)*100,1)}%]\n{doc}"
            for i, (doc, d) in enumerate(zip(docs, distances))
        )

        system_prompt = (
            "You are a WMS data analyst for Gray's WMS. "
            "Answer questions about trips, orders, pickers, vehicles, and deliveries. "
            "Use ONLY the provided context records. Be concise and factual. "
            "If context is insufficient, say so. Use bullet points where helpful."
        )
        user_prompt = f"Context from WMS database:\n\n{context}\n\nQuestion: {question}\n\nAnswer:"

        # ── Call the selected LLM ──────────────────────────────────────────
        if llm_provider == "openai":
            if _openai_mod is None:
                return jsonify({"success": False,
                                "answer": "OpenAI package not installed. Run: pip install openai",
                                "sources": []})
            if not openai_api_key:
                return jsonify({"success": False,
                                "answer": "OpenAI API key is required.", "sources": []})
            client   = _openai_mod.OpenAI(api_key=openai_api_key)
            response = client.chat.completions.create(
                model=openai_model,
                max_tokens=1024,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
            )
            answer = response.choices[0].message.content
        else:
            # default: Claude
            if not claude_api_key:
                return jsonify({"success": False,
                                "answer": "Claude API key is required.", "sources": []})
            message = anthropic.Anthropic(api_key=claude_api_key).messages.create(
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
                                 ("trip_id", "order_number", "trip_date",
                                  "customer", "picker", "status")})

        log.info(f"Query answered — {len(sources)} source(s) returned")
        return jsonify({"success": True, "answer": answer, "sources": sources})

    except Exception as e:
        log.error(f"Query error: {e}")
        return jsonify({"success": False, "answer": f"Error: {str(e)}", "sources": []})


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    banner("Gray's WMS RAG Service")
    log.info(f"Log file   : {LOG_FILE}")
    log.info(f"Vector DB  : {STORE_DIR}")
    log.info(f"Embed model: {EMBED_MODEL}")
    log.info(f"Port       : 8765")
    log.info("")
    log.info("Pre-loading embedding model...")
    try:
        get_embedder()
        get_store()
    except Exception as e:
        log.error(f"STARTUP FAILED: {e}")
        log.error("Check log file for details, then press Enter to exit.")
        input()
        sys.exit(1)

    banner("Service ready — http://127.0.0.1:8765")
    log.info("Press Ctrl+C to stop.")
    log.info("")
    app.run(host="127.0.0.1", port=8765, debug=False, threaded=True)
