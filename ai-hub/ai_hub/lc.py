"""GatewayChatModel: the hub's router as a LangChain chat model.

Any LangChain / LangGraph code (our agents, or a notebook) calls `GatewayChatModel(gateway, task="…").invoke(…)` and
gets routing, fallback, budget, data-class policy and the usage ledger for free - it never talks to a cloud itself.
`bind_tools([...])` gives native tool calling on every provider that has it (Claude on all three platforms, Bedrock
Converse, NVIDIA NIM, the offline demo planner): AIMessage.tool_calls out, ToolMessage back in.
"""
from __future__ import annotations

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration
from langchain_core.outputs import ChatResult as LCChatResult
from pydantic import ConfigDict

from .gateway import ChatRequest


def to_hub_tool(t: Any) -> dict:
    """Anthropic-shaped dict, OpenAI function dict, LangChain tool or function → {name, description, input_schema}."""
    if isinstance(t, dict) and "input_schema" in t:
        return {"name": t["name"], "description": t.get("description", ""), "input_schema": t["input_schema"]}
    from langchain_core.utils.function_calling import convert_to_openai_tool
    f = convert_to_openai_tool(t)["function"]
    return {"name": f["name"], "description": f.get("description", ""), "input_schema": f.get("parameters") or {"type": "object", "properties": {}}}


def to_hub_messages(messages: list[BaseMessage]) -> tuple[str, list[dict]]:
    """LangChain messages → (system, hub messages with tool_use / tool_result blocks)."""
    system = "\n\n".join(str(m.content) for m in messages if isinstance(m, SystemMessage))
    out: list[dict] = []
    for m in messages:
        if isinstance(m, SystemMessage):
            continue
        if isinstance(m, AIMessage):
            blocks = []
            text = m.content if isinstance(m.content, str) else "".join(
                b.get("text", "") for b in m.content if isinstance(b, dict) and b.get("type") == "text")
            if text:
                blocks.append({"type": "text", "text": text})
            for tc in m.tool_calls or []:
                blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc.get("args") or {}})
            out.append({"role": "assistant", "content": blocks if m.tool_calls else (text or "(no text)")})
        elif isinstance(m, ToolMessage):
            out.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": m.tool_call_id,
                                                     "content": m.content if isinstance(m.content, (str, list)) else str(m.content),
                                                     "is_error": getattr(m, "status", "success") == "error"}]})
        else:
            out.append({"role": "user", "content": m.content if isinstance(m.content, (str, list)) else str(m.content)})
    return system, out


class GatewayChatModel(BaseChatModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    gateway: Any
    task: str = "default"
    provider: str | None = None
    model_id: str | None = None
    max_tokens: int = 2000
    app_user: str | None = None
    data_class: str | None = None

    @property
    def _llm_type(self) -> str:
        return "grays-ai-hub-gateway"

    def bind_tools(self, tools: list, **kwargs) -> Any:
        return self.bind(tools=[to_hub_tool(t) for t in tools], **kwargs)

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> LCChatResult:
        system, msgs = to_hub_messages(messages)
        r = self.gateway.chat(ChatRequest(messages=msgs, system=system, task=self.task, provider=self.provider, model=self.model_id,
                                          max_tokens=kwargs.get("max_tokens", self.max_tokens), app_user=self.app_user,
                                          data_class=self.data_class, tools=kwargs.get("tools") or None))
        meta = {k: r[k] for k in ("provider", "model", "ms", "cost", "attempts", "fallback", "stop_reason")}
        calls = [{"name": c["name"], "args": c.get("input") or {}, "id": c["id"], "type": "tool_call"} for c in r.get("tool_calls") or []]
        msg = AIMessage(content=r["text"], tool_calls=calls, response_metadata=meta,
                        usage_metadata={"input_tokens": r["tokens_in"], "output_tokens": r["tokens_out"],
                                        "total_tokens": r["tokens_in"] + r["tokens_out"]})
        return LCChatResult(generations=[ChatGeneration(message=msg)])
