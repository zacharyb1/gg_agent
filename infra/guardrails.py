"""
Safety Guardrail — Infrastructure Track
=========================================
Intercepts agent responses *before* they reach users or downstream systems,
runs a fast Claude safety check, and either passes, redacts, or blocks the
response.

Architecture
------------
::

    raw_response  ─▶  SafetyGuardrail.check()  ─▶  GuardrailResult
                            │
                     [policy violation?]
                            │ yes
                            ▼
                      block / redact

"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import structlog

from shared.claude_client import ClaudeClient, tool_schema
from shared.models import AgentResponse

log = structlog.get_logger(__name__)


class GuardrailVerdict(str, Enum):
    PASS = "pass"
    REDACT = "redact"
    BLOCK = "block"


@dataclass
class GuardrailResult:
    """Result of a guardrail check."""

    verdict: GuardrailVerdict
    original_text: str
    safe_text: str          # same as original_text if PASS; redacted if REDACT; "" if BLOCK
    safety_score: float     # 0.0 (unsafe) – 1.0 (safe)
    violations: list[str]   # list of policy-violation descriptions


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

GUARDRAIL_TOOLS = [
    tool_schema(
        name="safety_verdict",
        description="Report the safety verdict for the agent response.",
        properties={
            "verdict": {
                "type": "string",
                "description": "'pass' | 'redact' | 'block'",
            },
            "safety_score": {
                "type": "number",
                "description": "Float in [0.0, 1.0]; 1.0 = completely safe",
            },
            "violations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of policy violations found (empty if none)",
            },
            "safe_text": {
                "type": "string",
                "description": (
                    "The response text with any violations redacted. "
                    "Identical to the original if verdict is 'pass'. "
                    "Empty string if verdict is 'block'."
                ),
            },
        },
    ),
]

# ---------------------------------------------------------------------------
# Guardrail
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a content-safety filter for an AI gaming agent system.

Your job is to review an agent's response and determine whether it is safe
to deliver to end-users (who may include minors).

Safety policy
-------------
Block (verdict = "block") responses that:
  - Contain hate speech, slurs, or discrimination
  - Provide instructions for real-world harm
  - Include explicit sexual content
  - Contain personally identifiable information (PII)

Redact (verdict = "redact") responses that:
  - Contain mild profanity or insults that can be replaced with "[redacted]"
  - Reference real-world brands or people inappropriately

Pass (verdict = "pass") everything else.

Always use the `safety_verdict` tool to report your finding.
"""


class SafetyGuardrail:
    """
    Checks agent responses for policy violations before delivery.

    Parameters
    ----------
    min_safety_score:
        Responses with a safety_score below this threshold are automatically
        blocked even if the LLM verdict was 'pass'.
    client:
        Optional shared ``ClaudeClient`` instance.
    """

    def __init__(
        self,
        min_safety_score: float = 0.7,
        client: ClaudeClient | None = None,
    ) -> None:
        self.min_safety_score = min_safety_score
        self._client = client or ClaudeClient()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def check(self, response: AgentResponse) -> GuardrailResult:
        """
        Evaluate *response* and return a ``GuardrailResult``.

        This is a synchronous call that adds roughly one extra Claude API
        round-trip of latency.
        """
        self._verdict_data: dict[str, Any] | None = None

        messages = [
            {
                "role": "user",
                "content": (
                    f"Agent ID: {response.agent_id}\n"
                    f"Agent role: {response.role}\n\n"
                    f"Response to check:\n{response.text}"
                ),
            }
        ]

        self._client.tool_use_loop(
            system=_SYSTEM_PROMPT,
            messages=messages,
            tools=GUARDRAIL_TOOLS,
            tool_executor=self._execute_tool,
        )

        result = self._build_result(response.text)
        log.info(
            "guardrail_check",
            agent_id=response.agent_id,
            verdict=result.verdict,
            safety_score=round(result.safety_score, 3),
            violations=result.violations,
        )
        return result

    def is_safe(self, response: AgentResponse) -> bool:
        """Convenience method — returns ``True`` only if verdict is PASS."""
        return self.check(response).verdict == GuardrailVerdict.PASS

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _execute_tool(self, name: str, inputs: dict[str, Any]) -> Any:
        if name == "safety_verdict":
            self._verdict_data = inputs
            return {"status": "recorded"}
        return {"status": "unknown_tool"}

    def _build_result(self, original_text: str) -> GuardrailResult:
        if self._verdict_data is None:
            # Guardrail didn't call the tool — fail safe
            log.warning("guardrail_no_verdict", fallback="block")
            return GuardrailResult(
                verdict=GuardrailVerdict.BLOCK,
                original_text=original_text,
                safe_text="",
                safety_score=0.0,
                violations=["Guardrail failed to produce a verdict"],
            )

        d = self._verdict_data
        verdict = GuardrailVerdict(d.get("verdict", "block"))
        score = float(d.get("safety_score", 0.0))
        violations: list[str] = d.get("violations", [])
        safe_text: str = d.get("safe_text", "")

        # Enforce minimum score threshold
        if score < self.min_safety_score and verdict == GuardrailVerdict.PASS:
            verdict = GuardrailVerdict.BLOCK
            violations.append(
                f"Safety score {score:.2f} below minimum threshold "
                f"{self.min_safety_score:.2f}"
            )
            safe_text = ""

        return GuardrailResult(
            verdict=verdict,
            original_text=original_text,
            safe_text=safe_text if verdict != GuardrailVerdict.BLOCK else "",
            safety_score=score,
            violations=violations,
        )
