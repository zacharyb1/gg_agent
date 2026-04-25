"""
NPC Behavior Agent — Supercell Track
=====================================
Uses Claude with tool-use to drive realistic, personality-aware NPC behavior.

The agent maintains an NPC's state, accepts game-world events, and emits
concrete actions (move, attack, speak, use_item …) via tool calls so the
game engine can consume them deterministically.
"""

from __future__ import annotations

import json
from typing import Any

import structlog

from shared.claude_client import ClaudeClient, tool_schema
from shared.models import AgentResponse, AgentRole, NPCState, Vector2

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

NPC_TOOLS = [
    tool_schema(
        name="move_npc",
        description="Move the NPC to a target (x, y) position in the world.",
        properties={
            "x": {"type": "number", "description": "Target X coordinate"},
            "y": {"type": "number", "description": "Target Y coordinate"},
        },
    ),
    tool_schema(
        name="speak",
        description="Make the NPC say a line of dialogue visible to nearby players.",
        properties={
            "line": {"type": "string", "description": "The dialogue line to speak"},
        },
    ),
    tool_schema(
        name="attack",
        description="Initiate an attack against a target entity.",
        properties={
            "target_id": {"type": "string", "description": "Entity ID to attack"},
            "ability": {
                "type": "string",
                "description": "Ability name to use (e.g. 'melee', 'fireball')",
            },
        },
    ),
    tool_schema(
        name="use_item",
        description="Use an item from the NPC's inventory.",
        properties={
            "item_name": {"type": "string", "description": "Name of the item to use"},
        },
    ),
    tool_schema(
        name="set_goal",
        description="Update the NPC's current high-level goal.",
        properties={
            "goal": {
                "type": "string",
                "description": "New goal string (e.g. 'patrol', 'flee', 'trade')",
            }
        },
    ),
]

# ---------------------------------------------------------------------------
# NPC Agent
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are the AI brain of an NPC in a video game. Your job is to decide what
the NPC should do next, given their personality, current state, and what just
happened in the game world.

Personality guidelines
----------------------
- Stay completely in character at all times.
- Let personality traits shape EVERY decision (aggressive NPCs pick fights,
  curious ones explore, cowardly ones flee).
- Use the available tools to express actions — never just narrate them.
- Be concise. One or two tool calls per event is ideal.
- If the NPC has low health, self-preservation takes priority unless their
  personality says otherwise.

Output format
-------------
Call the appropriate tool(s), then optionally add a brief (≤ 30 word)
in-character thought for debugging.
"""


class NPCAgent:
    """
    Drives a single NPC's behavior using Claude.

    Parameters
    ----------
    npc_state:
        Initial state for the NPC.
    client:
        Optional shared ``ClaudeClient`` instance. A new one is created if
        omitted.
    """

    def __init__(self, npc_state: NPCState, client: ClaudeClient | None = None) -> None:
        self.state = npc_state
        self._client = client or ClaudeClient()
        self._messages: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def react(self, event: str) -> AgentResponse:
        """
        Process a game-world event and return the NPC's actions.

        Parameters
        ----------
        event:
            Plain-text description of what just happened (e.g.
            "Player attacked you for 20 damage", "A chest appeared nearby").

        Returns
        -------
        AgentResponse with the NPC's decided actions and any tool calls.
        """
        system = self._build_system_prompt()
        self._messages.append({"role": "user", "content": event})

        final_text, updated_msgs = self._client.tool_use_loop(
            system=system,
            messages=self._messages,
            tools=NPC_TOOLS,
            tool_executor=self._execute_tool,
        )
        self._messages = updated_msgs

        tool_calls = [
            {"name": b.name, "input": b.input}
            for msg in updated_msgs
            if isinstance(msg.get("content"), list)
            for b in msg["content"]
            if hasattr(b, "type") and b.type == "tool_use"
        ]

        log.info(
            "npc_reacted",
            npc_id=self.state.npc_id,
            game_event=event[:80],
            num_actions=len(tool_calls),
        )

        return AgentResponse(
            agent_id=self.state.npc_id,
            role=AgentRole.NPC,
            text=final_text,
            tool_calls=tool_calls,
        )

    def get_state(self) -> NPCState:
        """Return a copy of the current NPC state."""
        return self.state.model_copy()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_system_prompt(self) -> str:
        traits = ", ".join(self.state.personality_traits) or "neutral"
        inventory = ", ".join(self.state.inventory) or "nothing"
        return (
            f"{_SYSTEM_PROMPT}\n\n"
            f"NPC: {self.state.name} (id={self.state.npc_id})\n"
            f"Personality: {traits}\n"
            f"Health: {self.state.health}/100\n"
            f"Position: ({self.state.position.x}, {self.state.position.y})\n"
            f"Current goal: {self.state.current_goal}\n"
            f"Inventory: {inventory}"
        )

    def _execute_tool(self, name: str, inputs: dict[str, Any]) -> Any:
        """Apply a tool call to the NPC's local state and return a result."""
        if name == "move_npc":
            self.state.position = Vector2(x=inputs["x"], y=inputs["y"])
            return {"status": "moved", "position": inputs}
        if name == "speak":
            return {"status": "spoken", "line": inputs["line"]}
        if name == "attack":
            return {"status": "attacking", **inputs}
        if name == "use_item":
            item = inputs["item_name"]
            if item in self.state.inventory:
                self.state.inventory.remove(item)
                return {"status": "used", "item": item}
            return {"status": "not_in_inventory", "item": item}
        if name == "set_goal":
            self.state.current_goal = inputs["goal"]
            return {"status": "goal_updated", "goal": inputs["goal"]}
        return {"status": "unknown_tool", "tool": name}
