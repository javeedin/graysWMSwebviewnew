"""GatewayChatModel: the hub's router as a LangChain chat model.

Any LangChain / LangGraph code (our agents, or a notebook) calls `GatewayChatModel(gateway, task="…").invoke(…)` and
gets routing, fallback, budget, data-class policy and the usage ledger for free - it never talks to a cloud itself.
"""
from __future__ import annotations

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from langchain_core.outputs import ChatGeneration
from langchain_core.outputs import ChatResult as LCChatResult
from pydantic import ConfigDict

from .gateway import ChatRequest


class GatewayChatModel(BaseChatModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    gateway: Any
    task: str = "default"
    provider: str | None = None
    model_id: str | None = None
    max_tokens: int = 2000
    app_user: str | None = None

    @property
    def _llm_type(self) -> str:
        return "grays-ai-hub-gateway"

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> LCChatResult:
        system = "\n\n".join(str(m.content) for m in messages if isinstance(m, SystemMessage))
        msgs = [{"role": "assistant" if m.type == "ai" else "user", "content": str(m.content)}
                for m in messages if not isinstance(m, SystemMessage)]
        r = self.gateway.chat(ChatRequest(messages=msgs, system=system, task=self.task, provider=self.provider, model=self.model_id,
                                          max_tokens=kwargs.get("max_tokens", self.max_tokens), app_user=self.app_user))
        meta = {k: r[k] for k in ("provider", "model", "ms", "cost", "attempts", "fallback", "stop_reason")}
        msg = AIMessage(content=r["text"], response_metadata=meta,
                        usage_metadata={"input_tokens": r["tokens_in"], "output_tokens": r["tokens_out"],
                                        "total_tokens": r["tokens_in"] + r["tokens_out"]})
        return LCChatResult(generations=[ChatGeneration(message=msg)])
