"""Model providers. Every provider answers chat(model, system, messages, max_tokens) → ChatResult.

  demo              offline, deterministic (tests, demos, the Pipeline Doctor without keys)
  anthropic         Claude on the Claude API                          anthropic.Anthropic
  bedrock           Claude in Amazon Bedrock (Messages API)           anthropic.AnthropicBedrockMantle, ids anthropic.claude-…
  claude_aws        Claude Platform on AWS (Anthropic-operated)       anthropic.AnthropicAWS, bare ids + workspace id
  bedrock_converse  other Bedrock models (Amazon Nova, Llama, Mistral …) through boto3 Converse; models discovered live
  nvidia            NVIDIA NIM hosted API (OpenAI-compatible REST at integrate.api.nvidia.com); models discovered live

Keys come from secrets.py as "<provider id>.<name>": aws_access_key / aws_secret_key (SigV4) or api_key (bearer
token for Bedrock / Claude Platform on AWS, the Claude API key, the NVIDIA nvapi- key).
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

from . import secrets


class ProviderError(Exception):
    pass


class ProviderRefusal(ProviderError):
    pass


@dataclass
class ChatResult:
    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str = ""
    ms: int = 0
    extra: dict = field(default_factory=dict)


def _messages(messages: list[dict]) -> list[dict]:
    """[{role, content:str}] → Anthropic message list (alternating, user first)."""
    out = []
    for m in messages or []:
        role = "assistant" if m.get("role") == "assistant" else "user"
        text = m.get("content") if isinstance(m.get("content"), str) else json.dumps(m.get("content"))
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n\n" + text
        else:
            out.append({"role": role, "content": text})
    if not out or out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": "(start)"})
    return out


class Provider:
    type = "base"

    def __init__(self, pid: str, cfg: dict):
        self.id, self.cfg = pid, cfg

    def secret(self, name: str) -> str | None:
        return secrets.get_secret(f"{self.id}.{name}")

    def configured(self) -> tuple[bool, str]:
        return True, ""

    def chat(self, model: str, system: str, messages: list[dict], max_tokens: int = 2000) -> ChatResult:
        raise NotImplementedError

    def list_models(self) -> list[dict]:
        return [{"id": m} for m in self.cfg.get("models") or []]

    def test(self) -> dict:
        model = (self.cfg.get("models") or [""])[0]
        if not model:
            return {"ok": False, "error": "Pick a model first (Discover lists what your account can use)."}
        t0 = time.time()
        r = self.chat(model, "Answer with one word.", [{"role": "user", "content": "Say OK."}], 50)
        return {"ok": True, "model": r.model, "ms": int((time.time() - t0) * 1000), "reply": r.text[:200],
                "tokens": [r.input_tokens, r.output_tokens]}


# ── Claude (three platforms, one SDK) ────────────────────────────
class _ClaudeBase(Provider):
    def client(self):
        raise NotImplementedError

    def chat(self, model, system, messages, max_tokens=2000):
        import anthropic
        t0 = time.time()
        try:
            kw = {"model": model, "max_tokens": max_tokens, "messages": _messages(messages)}
            if system:
                kw["system"] = system
            msg = self.client().messages.create(**kw)
        except anthropic.APIStatusError as e:
            raise ProviderError(f"{self.id}: HTTP {e.status_code} {getattr(e, 'message', e)}") from e
        except anthropic.APIError as e:
            raise ProviderError(f"{self.id}: {e}") from e
        if msg.stop_reason == "refusal":
            raise ProviderRefusal(f"{self.id}: the model declined this request")
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return ChatResult(text=text, model=model, input_tokens=msg.usage.input_tokens, output_tokens=msg.usage.output_tokens,
                          stop_reason=msg.stop_reason or "", ms=int((time.time() - t0) * 1000))


class AnthropicProvider(_ClaudeBase):
    type = "anthropic"

    def configured(self):
        return (True, "") if self.secret("api_key") else (False, "Claude API key missing")

    def client(self):
        import anthropic
        return anthropic.Anthropic(api_key=self.secret("api_key"), timeout=120.0)


def _aws_kwargs(p: Provider) -> dict:
    kw = {"aws_region": p.cfg.get("region") or None, "timeout": 120.0}
    if p.cfg.get("auth") == "bearer":
        kw["api_key"] = p.secret("api_key")
    elif p.cfg.get("auth") == "profile":
        kw["aws_profile"] = p.cfg.get("profile") or None
    else:
        kw["aws_access_key"] = p.secret("aws_access_key")
        kw["aws_secret_key"] = p.secret("aws_secret_key")
    return kw


def _aws_configured(p: Provider) -> tuple[bool, str]:
    if not p.cfg.get("region"):
        return False, "AWS region missing"
    a = p.cfg.get("auth", "keys")
    if a == "bearer":
        return (True, "") if p.secret("api_key") else (False, "Bedrock API key (bearer token) missing")
    if a == "profile":
        return True, ""
    return (True, "") if p.secret("aws_access_key") and p.secret("aws_secret_key") else (False, "AWS access key / secret missing")


class BedrockProvider(_ClaudeBase):
    """Claude in Amazon Bedrock: https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages"""
    type = "bedrock"

    def configured(self):
        return _aws_configured(self)

    def client(self):
        import anthropic
        return anthropic.AnthropicBedrockMantle(**_aws_kwargs(self))


class ClaudeAwsProvider(_ClaudeBase):
    """Claude Platform on AWS (Anthropic-operated, SigV4, AWS Marketplace billing): bare model ids + workspace id."""
    type = "claude_aws"

    def configured(self):
        ok, why = _aws_configured(self)
        if ok and not self.cfg.get("workspace_id"):
            return False, "Workspace ID missing"
        return ok, why

    def client(self):
        import anthropic
        return anthropic.AnthropicAWS(workspace_id=self.cfg.get("workspace_id") or None, **_aws_kwargs(self))


# ── Amazon Bedrock Converse (non-Claude models) ──────────────────
class BedrockConverseProvider(Provider):
    type = "bedrock_converse"

    def configured(self):
        return _aws_configured(self)

    def _session(self):
        import boto3
        a = self.cfg.get("auth", "keys")
        if a == "profile":
            return boto3.Session(profile_name=self.cfg.get("profile") or None, region_name=self.cfg.get("region"))
        if a == "bearer":
            import os
            os.environ["AWS_BEARER_TOKEN_BEDROCK"] = self.secret("api_key") or ""
            return boto3.Session(region_name=self.cfg.get("region"))
        return boto3.Session(aws_access_key_id=self.secret("aws_access_key"), aws_secret_access_key=self.secret("aws_secret_key"),
                             region_name=self.cfg.get("region"))

    def chat(self, model, system, messages, max_tokens=2000):
        from botocore.exceptions import BotoCoreError, ClientError
        t0 = time.time()
        msgs = [{"role": m["role"], "content": [{"text": m["content"]}]} for m in _messages(messages)]
        try:
            kw = {"modelId": model, "messages": msgs, "inferenceConfig": {"maxTokens": max_tokens}}
            if system:
                kw["system"] = [{"text": system}]
            r = self._session().client("bedrock-runtime").converse(**kw)
        except (ClientError, BotoCoreError) as e:
            raise ProviderError(f"{self.id}: {e}") from e
        text = "".join(c.get("text", "") for c in r["output"]["message"]["content"])
        u = r.get("usage") or {}
        return ChatResult(text=text, model=model, input_tokens=u.get("inputTokens", 0), output_tokens=u.get("outputTokens", 0),
                          stop_reason=r.get("stopReason", ""), ms=int((time.time() - t0) * 1000))

    def list_models(self):
        r = self._session().client("bedrock").list_foundation_models(byOutputModality="TEXT")
        out = []
        for s in r.get("modelSummaries", []):
            if s.get("providerName", "").lower() == "anthropic":
                continue                                    # Claude goes through the Bedrock (Messages API) provider
            out.append({"id": s["modelId"], "name": s.get("modelName"), "vendor": s.get("providerName"),
                        "on_demand": "ON_DEMAND" in (s.get("inferenceTypesSupported") or [])})
        return out


# ── NVIDIA NIM (hosted) ──────────────────────────────────────────
class NvidiaProvider(Provider):
    type = "nvidia"

    def configured(self):
        return (True, "") if self.secret("api_key") else (False, "NVIDIA API key (nvapi-…) missing")

    def _http(self):
        import httpx
        return httpx.Client(base_url=(self.cfg.get("base_url") or "https://integrate.api.nvidia.com/v1").rstrip("/"),
                            headers={"Authorization": f"Bearer {self.secret('api_key')}", "Accept": "application/json"}, timeout=120)

    def chat(self, model, system, messages, max_tokens=2000):
        import httpx
        t0 = time.time()
        msgs = ([{"role": "system", "content": system}] if system else []) + _messages(messages)
        try:
            with self._http() as h:
                r = h.post("/chat/completions", json={"model": model, "messages": msgs, "max_tokens": max_tokens, "stream": False})
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.id}: {e}") from e
        if r.status_code >= 400:
            raise ProviderError(f"{self.id}: HTTP {r.status_code} {r.text[:300]}")
        d = r.json()
        ch = (d.get("choices") or [{}])[0]
        u = d.get("usage") or {}
        return ChatResult(text=(ch.get("message") or {}).get("content") or "", model=model, input_tokens=u.get("prompt_tokens", 0),
                          output_tokens=u.get("completion_tokens", 0), stop_reason=ch.get("finish_reason") or "", ms=int((time.time() - t0) * 1000))

    def list_models(self):
        with self._http() as h:
            r = h.get("/models")
        if r.status_code >= 400:
            raise ProviderError(f"{self.id}: HTTP {r.status_code} {r.text[:200]}")
        return [{"id": m["id"], "vendor": m.get("owned_by")} for m in r.json().get("data", [])]


# ── Demo (offline) ───────────────────────────────────────────────
_DOCTOR_RULES = [
    (r"ORA-00904|invalid identifier", "INVALID_COLUMN", "A column in the task's SQL does not exist on the source (renamed, wrong alias or a typo).", "SQL"),
    (r"ORA-00942|table or view does not exist", "MISSING_OBJECT", "The SQL reads a table or view the runner user cannot see on this pod.", "SQL"),
    (r"ORA-01722|invalid number", "TYPE_MISMATCH", "Text that is not a number reaches a NUMBER column - force the column to TEXT in the column map.", "COLUMN_MAP"),
    (r"ORA-01843|ORA-01861|not a valid month|literal does not match", "DATE_FORMAT", "A date string does not match the expected format - cast it explicitly.", "SQL"),
    (r"ORA-00001|unique constraint", "DUPLICATE_KEY", "Two source rows share the merge key - the key columns are not unique.", "SETTINGS"),
    (r"timed? ?out|timeout", "TIMEOUT", "The source query is too slow for one page - lower the batch size or add a filter.", "SETTINGS"),
    (r"\b401\b|\b403\b|unauthori[sz]ed|forbidden|password", "AUTH", "The connection was refused - the password or token is wrong or expired.", "CONNECTION"),
]


class DemoProvider(Provider):
    type = "demo"

    def chat(self, model, system, messages, max_tokens=2000):
        t0 = time.time()
        user = "\n".join(m.get("content", "") for m in messages if m.get("role") != "assistant")
        sysl = system or ""
        if "PIPELINE_DOCTOR" in sysl:
            text = self._doctor(user)
        elif "FUSION_SQL" in sysl:
            m = re.search(r"VERIFIED_HINT:\s*```sql\s*(.*?)```", user, re.S)
            text = "```sql\n" + (m.group(1).strip() if m else "SELECT 1 AS n FROM dual") + "\n```"
        else:
            text = "Demo answer (offline provider): " + (user.strip().splitlines() or [""])[-1][:400]
        n_in, n_out = max(1, len((sysl + user).split()) * 4 // 3), max(1, len(text.split()) * 4 // 3)
        return ChatResult(text=text, model="demo", input_tokens=n_in, output_tokens=n_out, stop_reason="end_turn", ms=int((time.time() - t0) * 1000) + 5)

    @staticmethod
    def _doctor(ctx: str) -> str:
        err = ""
        m = re.search(r"ERROR:\s*(.+)", ctx)
        if m:
            err = m.group(1)
        for pat, cat, why, kind in _DOCTOR_RULES:
            if re.search(pat, err or ctx, re.I):
                break
        else:
            cat, why, kind = "UNKNOWN", "The log does not show a known pattern - look at the last error lines.", "NONE"
        patch, test_sql = {}, ""
        sql_m = re.search(r"TASK_SQL:\s*```sql\s*(.*?)```", ctx, re.S)
        sql = sql_m.group(1).strip() if sql_m else ""
        if cat == "INVALID_COLUMN" and sql:
            bad = re.search(r'"?([A-Z0-9_$#]+)"?: invalid identifier', err, re.I)
            col = bad.group(1).split(".")[-1] if bad else None
            if col:
                fixed = re.sub(r"\b" + re.escape(col) + r"\b", "NULL AS " + col, sql, count=1, flags=re.I)
                patch, test_sql = {"source_sql": fixed}, fixed
        elif cat == "TYPE_MISMATCH":
            patch = {"column_map_json": '{"SEE_LOG": "SEE_LOG:TEXT"}'}
        elif cat == "TIMEOUT":
            patch = {"batch_size": 1000}
        return "```json\n" + json.dumps({"category": cat, "cause": why, "confidence": 0.6 if cat != "UNKNOWN" else 0.2,
                                          "evidence": err[:300], "fix_kind": kind if patch or kind in ("CONNECTION", "NONE") else kind,
                                          "fix_summary": why, "patch": patch, "test_sql": test_sql}, indent=1) + "\n```"


TYPES = {"demo": DemoProvider, "anthropic": AnthropicProvider, "bedrock": BedrockProvider, "claude_aws": ClaudeAwsProvider,
         "bedrock_converse": BedrockConverseProvider, "nvidia": NvidiaProvider}


def make(pid: str, cfg: dict) -> Provider:
    cls = TYPES.get(cfg.get("type", pid))
    if not cls:
        raise ProviderError(f"Unknown provider type {cfg.get('type')}")
    return cls(pid, cfg)
