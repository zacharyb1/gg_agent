"""
Gaming Track Demo — Supercell track
=====================================
Demonstrates all three gaming agents:
  1. NPCAgent — drives NPC behaviour with tool calls
  2. ProcGenAgent — generates a dungeon and a quest
  3. BalancingAgent — analyses fake telemetry and recommends tweaks

Run:
    python examples/gaming_demo.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.models import GameState, NPCState, Vector2
from gaming import NPCAgent, ProcGenAgent, BalancingAgent


def demo_npc() -> None:
    print("\n" + "=" * 60)
    print("NPC AGENT DEMO")
    print("=" * 60)

    npc_state = NPCState(
        npc_id="goblin-42",
        name="Gruk the Goblin",
        health=60.0,
        position=Vector2(x=10.0, y=5.0),
        personality_traits=["cowardly", "greedy", "cunning"],
        current_goal="patrol",
        inventory=["health_potion", "stolen_gold"],
    )

    agent = NPCAgent(npc_state)

    events = [
        "A heavily-armoured knight just entered your patrol zone.",
        "You spot a dropped bag of coins 3 tiles to your north.",
    ]

    for event in events:
        print(f"\n[Event] {event}")
        response = agent.react(event)
        print(f"[NPC actions] {len(response.tool_calls)} tool call(s)")
        for tc in response.tool_calls:
            print(f"  → {tc['name']}: {tc['input']}")
        if response.text:
            print(f"[NPC thought] {response.text}")


def demo_procgen() -> None:
    print("\n" + "=" * 60)
    print("PROCEDURAL GENERATION DEMO")
    print("=" * 60)

    game_state = GameState(player_level=8, difficulty=2.5, world_seed=1337)
    agent = ProcGenAgent()

    print("\n[Generating dungeon + quest for a level-8 player …]")
    items = agent.generate(
        "Generate a water-themed dungeon and a companion side-quest.",
        game_state=game_state,
        count=2,
    )

    for item in items:
        print(f"\n  [{item.content_type.upper()}] {item.title}")
        print(f"  {item.description}")
        print(f"  Parameters: {item.parameters}")


def demo_balancing() -> None:
    print("\n" + "=" * 60)
    print("DYNAMIC BALANCING DEMO")
    print("=" * 60)

    telemetry = {
        "win_rate_level_5": 0.73,          # Too high — game too easy
        "avg_session_minutes": 5.8,         # Too short — players leaving early
        "day3_churn_rate": 0.41,            # High churn
        "enemy.goblin.attack_damage": 30,
        "loot.chest.gold_drop_rate": 0.05,
        "sample_size_level_5": 1200,
    }

    agent = BalancingAgent()
    actions = agent.analyse(telemetry)

    print(f"\n[Balancing actions ({len(actions)}):]")
    for action in actions:
        direction = "▲" if action.new_value > action.old_value else "▼"
        print(
            f"  {direction} {action.parameter}: "
            f"{action.old_value} → {action.new_value}  |  {action.reason}"
        )

    if agent.review_flags:
        print(f"\n[Flagged for human review ({len(agent.review_flags)}):]")
        for flag in agent.review_flags:
            print(f"  ⚠  {flag['metric']}: {flag['concern']}")


if __name__ == "__main__":
    demo_npc()
    demo_procgen()
    demo_balancing()
    print("\n✅  Gaming demo complete.")
