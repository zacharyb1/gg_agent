"""
Dynamic Balancing Agent — Supercell Track
==========================================
Analyses live gameplay telemetry and recommends — or automatically applies —
parameter tweaks to keep the game fun and fair.

The agent uses Claude's reasoning to interpret win-rate, session-length, and
churn signals, then emits ``BalancingAction`` objects via tool calls.
"""

from __future__ import annotations

from typing import Any

import structlog

from shared.claude_client import ClaudeClient, tool_schema
from shared.models import AgentResponse, AgentRole, BalancingAction, GameState

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

BALANCING_TOOLS = [
    tool_schema(
        name="adjust_parameter",
        description=(
            "Propose a numeric game-parameter adjustment. "
            "Each call represents one atomic tuning action."
        ),
        properties={
            "parameter": {
                "type": "string",
                "description": (
                    "Parameter path in dot-notation, e.g. "
                    "'enemy.goblin.attack_damage' or 'loot.chest.gold_drop_rate'"
                ),
            },
            "old_value": {"type": "number", "description": "Current value"},
            "new_value": {"type": "number", "description": "Recommended new value"},
            "reason": {
                "type": "string",
                "description": "One-sentence rationale referencing the telemetry data",
            },
        },
    ),
    tool_schema(
        name="flag_for_review",
        description="Flag a metric as needing human designer review before any change is made.",
        properties={
            "metric": {"type": "string", "description": "Metric name or parameter to review"},
            "concern": {
                "type": "string",
                "description": "Description of the concern",
            },
        },
    ),
]

# ---------------------------------------------------------------------------
# Balancing Agent
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a live-ops game-balancing AI for a mobile strategy game.

Your role is to analyse telemetry data and propose targeted parameter tweaks
that will improve player experience without destabilising the economy or
making the game too easy or too hard.

Balancing principles
--------------------
1. Win rate per level bracket should stay between 40–60%.
2. Average session length should be 8–15 minutes for mid-game players.
3. Churn within the first 3 days is a critical signal — prioritise changes
   that improve the new-player experience.
4. Never suggest a single parameter change larger than ±30 % in one pass.
5. If data is ambiguous or sample size < 100, use `flag_for_review` instead
   of making an automatic recommendation.
6. Explain your reasoning concisely in the `reason` field.
"""


class BalancingAgent:
    """
    Analyses gameplay telemetry and produces balancing recommendations.

    Parameters
    ----------
    client:
        Optional shared ``ClaudeClient`` instance.
    """

    def __init__(self, client: ClaudeClient | None = None) -> None:
        self._client = client or ClaudeClient()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyse(
        self,
        telemetry: dict[str, Any],
        game_state: GameState | None = None,
    ) -> list[BalancingAction]:
        """
        Analyse telemetry and return a list of balancing actions.

        Parameters
        ----------
        telemetry:
            Dict of metric name → value, e.g.::

                {
                    "win_rate_level_5": 0.72,
                    "avg_session_minutes": 6.3,
                    "day3_churn_rate": 0.45,
                    "enemy.goblin.attack_damage": 35,
                }

        game_state:
            Optional current game-state for additional context.

        Returns
        -------
        List of ``BalancingAction`` recommendations.
        """
        self._actions: list[BalancingAction] = []
        self._flags: list[dict[str, str]] = []

        context = self._build_context(telemetry, game_state)
        messages = [{"role": "user", "content": context}]

        self._client.tool_use_loop(
            system=_SYSTEM_PROMPT,
            messages=messages,
            tools=BALANCING_TOOLS,
            tool_executor=self._execute_tool,
        )

        log.info(
            "balancing_analysis_complete",
            actions=len(self._actions),
            flags=len(self._flags),
        )
        return list(self._actions)

    @property
    def review_flags(self) -> list[dict[str, str]]:
        """Metrics flagged for human review during the last ``analyse`` call."""
        return list(self._flags)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_context(telemetry: dict[str, Any], state: GameState | None) -> str:
        lines = ["Current telemetry snapshot:"]
        for k, v in telemetry.items():
            lines.append(f"  {k}: {v}")
        if state:
            lines.append(
                f"\nGame state — difficulty={state.difficulty:.1f}, "
                f"player_level={state.player_level}, tick={state.tick}"
            )
        lines.append("\nAnalyse the data and emit recommended parameter adjustments.")
        return "\n".join(lines)

    def _execute_tool(self, name: str, inputs: dict[str, Any]) -> Any:
        if name == "adjust_parameter":
            action = BalancingAction(
                parameter=inputs["parameter"],
                old_value=float(inputs["old_value"]),
                new_value=float(inputs["new_value"]),
                reason=inputs["reason"],
            )
            self._actions.append(action)
            return {"status": "recorded", "parameter": action.parameter}
        if name == "flag_for_review":
            self._flags.append(
                {"metric": inputs["metric"], "concern": inputs["concern"]}
            )
            return {"status": "flagged", "metric": inputs["metric"]}
        return {"status": "unknown_tool", "tool": name}
