"""
Unit tests for the gaming-track agents.

All Claude API calls are mocked so tests run without an API key.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.models import (
    BalancingAction,
    GameState,
    GeneratedContent,
    NPCState,
    Vector2,
)
from gaming.npc_agent import NPCAgent, NPC_TOOLS
from gaming.procgen_agent import ProcGenAgent
from gaming.balancing_agent import BalancingAgent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_text_response(text: str) -> MagicMock:
    """Build a mock anthropic.Message with a single TextBlock."""
    block = MagicMock()
    block.type = "text"
    block.text = text
    msg = MagicMock()
    msg.content = [block]
    msg.stop_reason = "end_turn"
    msg.usage.input_tokens = 100
    msg.usage.output_tokens = 50
    return msg


def _make_tool_response(tool_name: str, tool_input: dict[str, Any]) -> MagicMock:
    """Build a mock anthropic.Message that requests one tool call."""
    block = MagicMock()
    block.type = "tool_use"
    block.name = tool_name
    block.input = tool_input
    block.id = "fake-tool-id"
    msg = MagicMock()
    msg.content = [block]
    msg.stop_reason = "tool_use"
    msg.usage.input_tokens = 120
    msg.usage.output_tokens = 30
    return msg


# ---------------------------------------------------------------------------
# NPCAgent tests
# ---------------------------------------------------------------------------


class TestNPCAgent:
    def _make_agent(self) -> NPCAgent:
        state = NPCState(
            npc_id="goblin-1",
            name="Gruk",
            health=80.0,
            position=Vector2(x=0.0, y=0.0),
            personality_traits=["cowardly"],
            current_goal="patrol",
            inventory=["health_potion"],
        )
        return NPCAgent(state)

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_react_returns_agent_response(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        # First call: tool use; second call: end_turn
        mock_client.messages.create.side_effect = [
            _make_tool_response("speak", {"line": "Run away!"}),
            _make_text_response("Gruk squeaks and flees."),
        ]

        agent = self._make_agent()
        response = agent.react("A knight appeared!")

        assert response.agent_id == "goblin-1"
        assert response.role.value == "npc"

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_move_tool_updates_position(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response("move_npc", {"x": 5.0, "y": 7.0}),
            _make_text_response("Moved."),
        ]

        agent = self._make_agent()
        agent.react("Go north!")

        assert agent.state.position.x == 5.0
        assert agent.state.position.y == 7.0

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_use_item_removes_from_inventory(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response("use_item", {"item_name": "health_potion"}),
            _make_text_response("Used potion."),
        ]

        agent = self._make_agent()
        agent.react("Low health!")

        assert "health_potion" not in agent.state.inventory

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_use_item_not_in_inventory_is_safe(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response("use_item", {"item_name": "magic_sword"}),
            _make_text_response("No sword."),
        ]

        agent = self._make_agent()
        response = agent.react("Use your sword!")
        # Should not raise; inventory unchanged
        assert "health_potion" in agent.state.inventory

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_set_goal_updates_state(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response("set_goal", {"goal": "flee"}),
            _make_text_response("Fleeing!"),
        ]

        agent = self._make_agent()
        agent.react("Knight charging!")

        assert agent.state.current_goal == "flee"

    def test_get_state_returns_copy(self):
        agent = self._make_agent()
        state_copy = agent.get_state()
        state_copy.health = 0.0
        assert agent.state.health == 80.0   # original unchanged


# ---------------------------------------------------------------------------
# ProcGenAgent tests
# ---------------------------------------------------------------------------


class TestProcGenAgent:
    @patch("shared.claude_client.anthropic.Anthropic")
    def test_generate_returns_content_items(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "emit_content",
                {
                    "content_type": "dungeon",
                    "title": "Sunken Catacombs",
                    "description": "A water-filled maze.",
                    "parameters": {"rooms": 10, "boss": "Sea Witch"},
                },
            ),
            _make_text_response("Done."),
        ]

        agent = ProcGenAgent()
        results = agent.generate("Generate a water dungeon.")

        assert len(results) == 1
        assert isinstance(results[0], GeneratedContent)
        assert results[0].content_type == "dungeon"
        assert results[0].title == "Sunken Catacombs"

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_generate_with_game_state(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_text_response("No content generated."),
        ]

        agent = ProcGenAgent()
        state = GameState(player_level=5, difficulty=1.5)
        results = agent.generate("Generate a quest.", game_state=state)
        # No tool calls → empty list is valid
        assert isinstance(results, list)

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_generate_multiple_items(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        def tool_call_seq(tool_name, tool_input):
            # Return tool_use twice, then end_turn
            call_count = mock_client.messages.create.call_count
            if call_count <= 2:
                return _make_tool_response(
                    "emit_content",
                    {
                        "content_type": "quest",
                        "title": f"Quest {call_count}",
                        "description": "A quest.",
                        "parameters": {},
                    },
                )
            return _make_text_response("Done.")

        # Build explicit side_effect list
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "emit_content",
                {"content_type": "quest", "title": "Quest 1", "description": "Q1", "parameters": {}},
            ),
            _make_tool_response(
                "emit_content",
                {"content_type": "item", "title": "Sword", "description": "Sharp", "parameters": {}},
            ),
            _make_text_response("All done."),
        ]

        agent = ProcGenAgent()
        results = agent.generate("Generate a quest and an item.", count=2)
        assert len(results) == 2


# ---------------------------------------------------------------------------
# BalancingAgent tests
# ---------------------------------------------------------------------------


class TestBalancingAgent:
    @patch("shared.claude_client.anthropic.Anthropic")
    def test_analyse_returns_actions(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "adjust_parameter",
                {
                    "parameter": "enemy.goblin.attack_damage",
                    "old_value": 30,
                    "new_value": 25,
                    "reason": "Win rate too high at level 5.",
                },
            ),
            _make_text_response("Analysis complete."),
        ]

        agent = BalancingAgent()
        actions = agent.analyse({"win_rate_level_5": 0.73})

        assert len(actions) == 1
        assert isinstance(actions[0], BalancingAction)
        assert actions[0].parameter == "enemy.goblin.attack_damage"
        assert actions[0].new_value == 25.0

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_analyse_flags_for_review(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "flag_for_review",
                {
                    "metric": "win_rate_new_players",
                    "concern": "Sample size too small.",
                },
            ),
            _make_text_response("Flagged."),
        ]

        agent = BalancingAgent()
        actions = agent.analyse({"win_rate_new_players": 0.5, "sample_size_new": 20})

        assert len(actions) == 0
        assert len(agent.review_flags) == 1
        assert agent.review_flags[0]["metric"] == "win_rate_new_players"

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_analyse_with_game_state(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_text_response("No actions needed.")

        agent = BalancingAgent()
        state = GameState(difficulty=1.0, player_level=3)
        actions = agent.analyse({}, game_state=state)
        assert isinstance(actions, list)
