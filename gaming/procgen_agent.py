"""
Procedural Generation Agent — Supercell Track
==============================================
Generates coherent game content (dungeons, quests, items, dialogue) using
Claude. The agent accepts a *seed* context (theme, player level, world state)
and returns structured ``GeneratedContent`` objects ready to be loaded by the
game engine.
"""

from __future__ import annotations

import json
from typing import Any

import structlog

from shared.claude_client import ClaudeClient, tool_schema
from shared.models import AgentResponse, AgentRole, GameState, GeneratedContent

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

PROCGEN_TOOLS = [
    tool_schema(
        name="emit_content",
        description=(
            "Emit a complete piece of generated content. Call this once per "
            "content item you want to produce."
        ),
        properties={
            "content_type": {
                "type": "string",
                "description": "Type of content: dungeon | quest | item | dialogue | event",
            },
            "title": {"type": "string", "description": "Short memorable title"},
            "description": {
                "type": "string",
                "description": "Rich description used to instantiate the content in the engine",
            },
            "parameters": {
                "type": "object",
                "description": (
                    "Key/value pairs consumed by the engine "
                    "(e.g. {\"rooms\": 12, \"boss\": \"Lich King\"})"
                ),
            },
        },
    ),
]

# ---------------------------------------------------------------------------
# Proc-gen Agent
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a procedural-content-generation AI for a fantasy mobile game similar
to Clash of Clans or Brawl Stars.

Your task is to create original, varied, and thematically coherent game
content that matches the player's current level and the world's lore.

Guidelines
----------
- Scale difficulty and complexity with player level.
- Make each piece of content feel unique — avoid generic names and clichés.
- Use the `emit_content` tool for EVERY piece of content you produce.
- You may emit 1–5 content items per request.
- Populate `parameters` with concrete engine-readable values (numbers, strings,
  lists) — not narrative prose.
- Ensure generated items feel balanced and fair for the player level.
"""


class ProcGenAgent:
    """
    Generates game content using Claude.

    Parameters
    ----------
    client:
        Optional shared ``ClaudeClient`` instance.
    """

    def __init__(self, client: ClaudeClient | None = None) -> None:
        self._client = client or ClaudeClient()
        self._generated: list[GeneratedContent] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate(
        self,
        request: str,
        game_state: GameState | None = None,
        count: int = 1,
    ) -> list[GeneratedContent]:
        """
        Generate game content from a natural-language request.

        Parameters
        ----------
        request:
            What to generate, e.g. "Generate a mid-game dungeon with a
            water theme for a level-8 player."
        game_state:
            Current game state used to calibrate content difficulty.
        count:
            Hint for how many content items to produce (1–5).

        Returns
        -------
        List of ``GeneratedContent`` objects.
        """
        context = self._build_context(game_state, count)
        messages = [{"role": "user", "content": f"{context}\n\nRequest: {request}"}]

        self._generated = []

        self._client.tool_use_loop(
            system=_SYSTEM_PROMPT,
            messages=messages,
            tools=PROCGEN_TOOLS,
            tool_executor=self._execute_tool,
        )

        log.info(
            "procgen_complete",
            request=request[:80],
            items_generated=len(self._generated),
        )
        return list(self._generated)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_context(self, state: GameState | None, count: int) -> str:
        if state is None:
            return f"Generate {count} content item(s). No additional world context."
        return (
            f"World context — "
            f"player_level={state.player_level}, "
            f"difficulty={state.difficulty:.1f}, "
            f"world_seed={state.world_seed}, "
            f"score={state.player_score}. "
            f"Generate {count} content item(s)."
        )

    def _execute_tool(self, name: str, inputs: dict[str, Any]) -> Any:
        if name == "emit_content":
            content = GeneratedContent(
                content_type=inputs.get("content_type", "unknown"),
                title=inputs.get("title", "Untitled"),
                description=inputs.get("description", ""),
                parameters=inputs.get("parameters", {}),
            )
            self._generated.append(content)
            return {"status": "emitted", "title": content.title}
        return {"status": "unknown_tool", "tool": name}
