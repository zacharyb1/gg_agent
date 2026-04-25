"""
Claude API client with production-grade best practices:
- Automatic retry with exponential back-off (tenacity)
- Structured logging (structlog)
- Tool-use / function-calling helpers
- Token usage tracking
"""

from __future__ import annotations

import os
from typing import Any

import anthropic
import structlog
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential

load_dotenv()

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Recommended defaults
# ---------------------------------------------------------------------------

DEFAULT_MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-4-5")
DEFAULT_MAX_TOKENS = int(os.getenv("GUARDRAIL_MAX_TOKENS", "4096"))


class ClaudeClient:
    """
    Thin wrapper around the Anthropic SDK that adds:
    - Retry logic for transient API errors
    - Structured logging of every call
    - Helpers for tool-use patterns
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> None:
        self._client = anthropic.Anthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
        self.model = model
        self.max_tokens = max_tokens

    # ------------------------------------------------------------------
    # Core call – with retry
    # ------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def call(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int | None = None,
    ) -> anthropic.types.Message:
        """Send a request to Claude and return the raw SDK Message object."""
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens or self.max_tokens,
            "system": system,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools

        log.debug(
            "claude_call",
            model=self.model,
            num_messages=len(messages),
            has_tools=bool(tools),
        )

        response = self._client.messages.create(**kwargs)

        log.info(
            "claude_response",
            model=self.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            stop_reason=response.stop_reason,
        )
        return response

    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    def text_response(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        max_tokens: int | None = None,
    ) -> str:
        """Return just the text content of the first assistant message."""
        response = self.call(system=system, messages=messages, max_tokens=max_tokens)
        return _extract_text(response)

    def tool_use_loop(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
        max_rounds: int = 10,
    ) -> tuple[str, list[dict[str, Any]]]:
        """
        Drive a full tool-use agentic loop until Claude stops requesting
        tool calls or *max_rounds* is reached.

        Returns:
            (final_text, full_messages_history)
        """
        msgs = list(messages)
        for _ in range(max_rounds):
            response = self.call(system=system, messages=msgs, tools=tools)

            # Accumulate the assistant turn
            assistant_content = response.content
            msgs.append({"role": "assistant", "content": assistant_content})

            if response.stop_reason != "tool_use":
                # No more tool calls – return the final text
                return _extract_text(response), msgs

            # Execute every tool the model requested
            tool_results: list[dict[str, Any]] = []
            for block in assistant_content:
                if block.type == "tool_use":
                    result = tool_executor(block.name, block.input)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": str(result),
                        }
                    )

            msgs.append({"role": "user", "content": tool_results})

        log.warning("tool_use_loop_max_rounds_reached", max_rounds=max_rounds)
        return _extract_text(response), msgs  # type: ignore[possibly-undefined]


# ---------------------------------------------------------------------------
# Type alias for tool executor callbacks
# ---------------------------------------------------------------------------

ToolExecutor = "Callable[[str, dict[str, Any]], Any]"  # noqa: F821 – annotative only


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_text(message: anthropic.types.Message) -> str:
    """Pull the first TextBlock from a Claude response."""
    for block in message.content:
        if hasattr(block, "text"):
            return block.text
    return ""


# ---------------------------------------------------------------------------
# Tool schema builder helpers  (makes it easy to define Claude tools)
# ---------------------------------------------------------------------------


def tool_schema(
    name: str,
    description: str,
    properties: dict[str, Any],
    required: list[str] | None = None,
) -> dict[str, Any]:
    """
    Build a Claude tool definition dict.

    Example
    -------
    >>> tool_schema(
    ...     name="move_npc",
    ...     description="Move an NPC to a target position.",
    ...     properties={
    ...         "npc_id": {"type": "string"},
    ...         "x": {"type": "number"},
    ...         "y": {"type": "number"},
    ...     },
    ...     required=["npc_id", "x", "y"],
    ... )
    """
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required or list(properties.keys()),
        },
    }
