"""
Shared Pydantic models used across gaming and infra tracks.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Generic agent types
# ---------------------------------------------------------------------------


class AgentRole(str, Enum):
    """High-level role an agent plays in the system."""

    NPC = "npc"
    PROC_GEN = "proc_gen"
    BALANCER = "balancer"
    MONITOR = "monitor"
    EVALUATOR = "evaluator"
    GUARDRAIL = "guardrail"


class AgentMessage(BaseModel):
    """A single message exchanged with an agent."""

    role: str  # "user" | "assistant"
    content: str


class AgentContext(BaseModel):
    """Mutable execution context passed through an agent's reasoning loop."""

    agent_id: str
    role: AgentRole
    conversation: list[AgentMessage] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentResponse(BaseModel):
    """Structured response from any agent call."""

    agent_id: str
    role: AgentRole
    text: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str = "end_turn"


# ---------------------------------------------------------------------------
# Evaluation / monitoring types
# ---------------------------------------------------------------------------


class EvalScore(BaseModel):
    """Result of a single evaluation dimension."""

    dimension: str
    score: float = Field(ge=0.0, le=1.0)
    rationale: str


class EvalReport(BaseModel):
    """Aggregated evaluation report for a single agent response."""

    agent_id: str
    scores: list[EvalScore]

    @property
    def overall(self) -> float:
        if not self.scores:
            return 0.0
        return sum(s.score for s in self.scores) / len(self.scores)


# ---------------------------------------------------------------------------
# Gaming-specific types
# ---------------------------------------------------------------------------


class Vector2(BaseModel):
    """2-D position / direction."""

    x: float = 0.0
    y: float = 0.0


class NPCState(BaseModel):
    """Snapshot of an NPC's runtime state."""

    npc_id: str
    name: str
    health: float = Field(ge=0.0, le=100.0, default=100.0)
    position: Vector2 = Field(default_factory=Vector2)
    personality_traits: list[str] = Field(default_factory=list)
    current_goal: str = "idle"
    inventory: list[str] = Field(default_factory=list)


class GameState(BaseModel):
    """Snapshot of the overall game world."""

    tick: int = 0
    active_npcs: list[NPCState] = Field(default_factory=list)
    player_level: int = 1
    player_score: int = 0
    world_seed: int = 42
    difficulty: float = Field(ge=0.1, le=10.0, default=1.0)


class GeneratedContent(BaseModel):
    """Piece of procedurally generated game content."""

    content_type: str  # "dungeon" | "quest" | "item" | "dialogue" …
    title: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class BalancingAction(BaseModel):
    """A tuning action produced by the balancing agent."""

    parameter: str
    old_value: float
    new_value: float
    reason: str
