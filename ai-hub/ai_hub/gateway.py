"""The model gateway: one call in, the right model out.

For a request (task, messages, optional provider/model) it builds the candidate list (explicit target, else the
task's route), keeps only providers that are enabled, configured and allowed the task's data class, stops when the
monthly budget is spent, tries the candidates in order (the next one on an error or a refusal) and records every
attempt in the usage ledger with its cost.
"""
from __future__ import annotations

import concurrent.futures as cf
import time
from dataclasses import asdict, dataclass

from . import providers as P
from .config import HubConfig
from .usage import Usage


class GatewayError(Exception):
    def __init__(self, message: str, attempts: list | None = None):
        super().__init__(message)
        self.attempts = attempts or []


@dataclass
class ChatRequest:
    messages: list
    system: str = ""
    task: str = "default"
    provider: str | None = None
    model: str | None = None
    max_tokens: int = 2000
    data_class: str | None = None
    app_user: str | None = None
    fallback: bool = True


class Gateway:
    def __init__(self, cfg: HubConfig, usage: Usage):
        self.cfg, self.usage = cfg, usage
        self._providers: dict[str, P.Provider] = {}

    def provider(self, pid: str) -> P.Provider:
        pc = self.cfg.providers.get(pid)
        if pc is None:
            raise P.ProviderError(f"No provider {pid}")
        return P.make(pid, pc)                     # cheap; picks up changed settings / keys at once

    def status(self) -> list[dict]:
        out = []
        for pid, pc in self.cfg.providers.items():
            try:
                ok, why = self.provider(pid).configured()
            except Exception as e:  # noqa: BLE001
                ok, why = False, str(e)
            out.append({"id": pid, **{k: v for k, v in pc.items()}, "configured": ok, "missing": why})
        return out

    def candidates(self, req: ChatRequest) -> tuple[list[dict], list[dict]]:
        """→ (usable candidates, skipped with reasons)"""
        dc = req.data_class or self.cfg.task_data_class.get(req.task, "internal")
        if req.provider:
            raw = [{"provider": req.provider, "model": req.model or (self.cfg.providers.get(req.provider, {}).get("models") or [""])[0]}]
        else:
            raw = list(self.cfg.routes.get(req.task) or self.cfg.routes.get("default") or [])
        use, skipped = [], []
        for c in raw:
            pc = self.cfg.providers.get(c.get("provider"))
            why = None
            if not pc:
                why = "unknown provider"
            elif not pc.get("enabled"):
                why = "switched off"
            elif dc not in (pc.get("data_classes") or []):
                why = f"not allowed to see {dc} data"
            elif not c.get("model"):
                why = "no model chosen"
            else:
                ok, missing = self.provider(c["provider"]).configured()
                if not ok:
                    why = missing
            (skipped if why else use).append(dict(c, reason=why) if why else c)
        return use, skipped

    def chat(self, req: ChatRequest) -> dict:
        use, skipped = self.candidates(req)
        if not use:
            raise GatewayError("No provider can take this request: " + "; ".join(f"{s['provider']} ({s['reason']})" for s in skipped), skipped)
        spent, budget = self.usage.month_cost(), self.cfg.budget_month_usd
        paid = [c for c in use if sum(self.cfg.price(c["model"])) > 0]
        if budget and spent >= budget and paid:
            use = [c for c in use if c not in paid]
            skipped += [dict(c, reason=f"monthly budget ${budget:.2f} used (${spent:.2f})") for c in paid]
            if not use:
                raise GatewayError(f"The monthly AI budget of ${budget:.2f} is used up (${spent:.2f}).", skipped)
        if not req.fallback:
            use = use[:1]
        attempts = []
        for i, c in enumerate(use, 1):
            t0 = time.time()
            try:
                r = self.provider(c["provider"]).chat(c["model"], req.system, req.messages, req.max_tokens)
            except P.ProviderError as e:
                ms = int((time.time() - t0) * 1000)
                attempts.append({"provider": c["provider"], "model": c["model"], "ok": False, "error": str(e), "ms": ms})
                self.usage.add(task=req.task, provider=c["provider"], model=c["model"], ok=False, error=str(e), ms=ms,
                               app_user=req.app_user, attempt=i, fallback=i > 1)
                continue
            pin, pout = self.cfg.price(c["model"])
            cost = round(r.input_tokens / 1e6 * pin + r.output_tokens / 1e6 * pout, 6)
            self.usage.add(task=req.task, provider=c["provider"], model=r.model, ok=True, ms=r.ms, tokens_in=r.input_tokens,
                           tokens_out=r.output_tokens, cost=cost, app_user=req.app_user, attempt=i, fallback=i > 1)
            attempts.append({"provider": c["provider"], "model": r.model, "ok": True, "ms": r.ms})
            return {"text": r.text, "provider": c["provider"], "model": r.model, "ms": r.ms, "tokens_in": r.input_tokens,
                    "tokens_out": r.output_tokens, "cost": cost, "stop_reason": r.stop_reason, "attempts": attempts, "skipped": skipped,
                    "fallback": i > 1}
        raise GatewayError("Every provider failed: " + "; ".join(a["error"] for a in attempts), attempts + skipped)

    def compare(self, req: ChatRequest, targets: list[dict]) -> list[dict]:
        """The same prompt to several provider/model pairs at once (Playground)."""
        def one(t):
            r = ChatRequest(**{**asdict(req), "provider": t["provider"], "model": t.get("model"), "fallback": False})
            try:
                return {"target": t, "ok": True, **self.chat(r)}
            except GatewayError as e:
                return {"target": t, "ok": False, "error": str(e)}
        with cf.ThreadPoolExecutor(max_workers=min(6, len(targets) or 1)) as ex:
            return list(ex.map(one, targets))
