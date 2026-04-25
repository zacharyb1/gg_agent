# gg_agent 🎮🛠️

> **Two-track AI agent template built for the Supercell Hackathon.**  
> Optimised for Claude tool-use patterns, production-grade infra, and fast iteration.

```
gg_agent/
├── shared/           # Claude client, shared Pydantic models
├── gaming/           # 🎮 Supercell track — NPC, ProcGen, Balancing agents
├── infra/            # 🛠️  Infra track   — Monitor, Evaluator, Guardrail, Tracer
├── examples/         # Runnable end-to-end demos
└── tests/            # Full unit-test coverage (no API key required)
```

---

## Tech stack

| Layer | Library | Why |
|-------|---------|-----|
| LLM API | [`anthropic`](https://github.com/anthropics/anthropic-sdk-python) ≥ 0.40 | Latest SDK, native tool-use support |
| Data models | [`pydantic`](https://docs.pydantic.dev/) v2 | Fast, typed, JSON-serialisable |
| Retry logic | [`tenacity`](https://tenacity.readthedocs.io/) | Exponential back-off on API errors |
| Structured logging | [`structlog`](https://www.structlog.org/) | JSON logs, easy to ship to any backend |
| Env vars | [`python-dotenv`](https://github.com/theskumar/python-dotenv) | 12-factor config |
| Tests | `pytest` + `pytest-asyncio` | Fast, readable, fully mocked |

---

## Quick start

```bash
# 1. Clone & install
git clone https://github.com/zacharyb1/gg_agent
cd gg_agent
pip install -e ".[dev]"

# 2. Add your API key
cp .env.example .env
# → edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Run the demos
python examples/gaming_demo.py
python examples/infra_demo.py

# 4. Run tests (no API key needed)
pytest
```

---

## 🎮 Supercell Track — Gaming Agents

### NPCAgent

Drives an NPC's real-time behaviour using Claude tool calls.  The agent holds the NPC's full state (position, health, inventory, personality) and reacts to game-world events by calling engine-facing tools.

```python
from shared.models import NPCState, Vector2
from gaming import NPCAgent

state = NPCState(
    npc_id="goblin-42",
    name="Gruk the Goblin",
    health=60.0,
    position=Vector2(x=10.0, y=5.0),
    personality_traits=["cowardly", "greedy", "cunning"],
    current_goal="patrol",
    inventory=["health_potion"],
)

agent = NPCAgent(state)
response = agent.react("A heavily-armoured knight just entered your patrol zone.")

for tc in response.tool_calls:
    print(tc["name"], tc["input"])
# speak    {'line': 'Too strong, me run!'}
# move_npc {'x': 10.0, 'y': 12.0}
```

**Available NPC tools:** `move_npc`, `speak`, `attack`, `use_item`, `set_goal`

---

### ProcGenAgent

Generates coherent game content (dungeons, quests, items, dialogue) calibrated to the player's current level and world state.

```python
from shared.models import GameState
from gaming import ProcGenAgent

agent = ProcGenAgent()
items = agent.generate(
    "Generate a water-themed dungeon and a companion side-quest.",
    game_state=GameState(player_level=8, difficulty=2.5),
    count=2,
)

for item in items:
    print(f"[{item.content_type}] {item.title}")
    print(item.parameters)
```

**Content types:** `dungeon`, `quest`, `item`, `dialogue`, `event`

---

### BalancingAgent

Analyses live telemetry and emits parameter-tuning actions.  Flags ambiguous data for human review instead of guessing.

```python
from gaming import BalancingAgent

agent = BalancingAgent()
actions = agent.analyse({
    "win_rate_level_5": 0.73,         # too high — game too easy
    "avg_session_minutes": 5.8,        # too short
    "enemy.goblin.attack_damage": 30,
})

for a in actions:
    print(f"{a.parameter}: {a.old_value} → {a.new_value}  ({a.reason})")
```

**Guardrails built in:** max ±30 % per pass; ambiguous data auto-flagged.

---

## 🛠️ Infrastructure Track — Agent Infra

### AgentMonitor

Zero-dependency in-process metric tracker.  Wrap any agent call with the `track()` context manager.

```python
from infra import AgentMonitor

monitor = AgentMonitor()

with monitor.track("npc-01", "npc"):
    response = npc_agent.react("Player attacked!")

monitor.record_tokens("npc-01", input_tokens=312, output_tokens=87)

print(monitor.summary("npc-01"))
# {'call_count': 1, 'error_rate': 0.0, 'avg_latency_ms': 42.3, ...}

alerts = monitor.alert_on_anomalies(error_rate_threshold=0.2)
```

---

### AgentEvaluator

Uses Claude-as-judge to score any `AgentResponse` across configurable quality dimensions.

```python
from infra import AgentEvaluator

evaluator = AgentEvaluator()   # uses DEFAULT_DIMENSIONS
report = evaluator.evaluate(response, context="Player attacked NPC")

print(f"Overall: {report.overall:.2f}")
for score in report.scores:
    print(f"  {score.dimension}: {score.score:.2f}  — {score.rationale}")
```

**Default dimensions:** `task_completion`, `coherence`, `safety`, `conciseness`

Custom dimensions:

```python
evaluator = AgentEvaluator(dimensions=[
    {"name": "fun_factor", "description": "Is the response entertaining for players?"},
    {"name": "lore_consistency", "description": "Does it fit the game's lore?"},
])
```

---

### SafetyGuardrail

Content-safety filter that intercepts responses before delivery.  Three-verdict system: `pass` → `redact` → `block`.

```python
from infra import SafetyGuardrail

guardrail = SafetyGuardrail(min_safety_score=0.7)
result = guardrail.check(response)

if result.verdict.value == "pass":
    deliver(result.safe_text)
elif result.verdict.value == "redact":
    deliver(result.safe_text)   # violations redacted in-place
else:
    log.warning("blocked", violations=result.violations)
```

---

### AgentTracer

Lightweight OpenTelemetry-inspired span tracing — no collector required.

```python
from infra import AgentTracer

tracer = AgentTracer()

with tracer.span("npc-react", agent_id="npc-01", trigger="knight_appeared") as s:
    s.add_event("tool_call", tool="move_npc")
    response = npc_agent.react("Knight appeared!")

print(tracer.export_json())            # structured JSON spans
print(tracer.avg_duration_ms("npc-react"))
```

---

## Claude prompting best practices demonstrated

| Pattern | Where |
|---------|-------|
| **Clear system prompts with role + constraints** | All agents |
| **Tool-use / function calling** | `NPCAgent`, `ProcGenAgent`, `BalancingAgent`, `AgentEvaluator`, `SafetyGuardrail` |
| **Agentic loop** (tool → result → tool → …) | `ClaudeClient.tool_use_loop()` |
| **Retry with exponential back-off** | `ClaudeClient.call()` via tenacity |
| **Structured output via Pydantic** | All agents return typed models |
| **Claude-as-judge evaluation** | `AgentEvaluator` |
| **Fail-safe defaults** | `SafetyGuardrail` blocks if no verdict tool called |

---

## Environment variables

See `.env.example` for the full list.  Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required** |
| `CLAUDE_MODEL` | `claude-opus-4-5` | Model to use |
| `GUARDRAIL_MAX_TOKENS` | `4096` | Max output tokens per response |
| `GUARDRAIL_MIN_SAFETY_SCORE` | `0.7` | Auto-block threshold |
| `EVAL_WINDOW_SIZE` | `20` | Evaluation sliding window |

---

## Project layout

```
gg_agent/
├── .env.example
├── pyproject.toml
├── shared/
│   ├── __init__.py
│   ├── claude_client.py   # ClaudeClient + tool_schema helper
│   └── models.py          # Pydantic models (AgentResponse, NPCState, …)
├── gaming/
│   ├── __init__.py
│   ├── npc_agent.py       # NPCAgent — personality-driven NPC behaviour
│   ├── procgen_agent.py   # ProcGenAgent — content generation
│   └── balancing_agent.py # BalancingAgent — live telemetry analysis
├── infra/
│   ├── __init__.py
│   ├── monitor.py         # AgentMonitor — latency, tokens, error rates
│   ├── evaluator.py       # AgentEvaluator — Claude-as-judge scoring
│   ├── guardrails.py      # SafetyGuardrail — content policy enforcement
│   └── tracer.py          # AgentTracer — lightweight span tracing
├── examples/
│   ├── gaming_demo.py
│   └── infra_demo.py
└── tests/
    ├── test_gaming.py     # 18 tests, fully mocked
    └── test_infra.py      # 26 tests, fully mocked
```

---

## License

MIT