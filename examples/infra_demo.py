"""
Infrastructure Track Demo
===========================
Demonstrates the four infra-track components:
  1. AgentMonitor  — tracks latency, tokens, errors
  2. AgentEvaluator — Claude-as-judge scoring
  3. SafetyGuardrail — content policy enforcement
  4. AgentTracer — lightweight span tracing

Run:
    python examples/infra_demo.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.models import AgentResponse, AgentRole
from infra import AgentMonitor, AgentEvaluator, SafetyGuardrail, AgentTracer


# ── Fake responses for the demo (no API key needed for monitor/tracer) ──────

GOOD_RESPONSE = AgentResponse(
    agent_id="npc-42",
    role=AgentRole.NPC,
    text=(
        "Gruk spots the knight and immediately ducks behind a boulder, "
        "whispering 'Too strong! Need to run!' before bolting north."
    ),
    tool_calls=[
        {"name": "speak", "input": {"line": "Too strong! Need to run!"}},
        {"name": "move_npc", "input": {"x": 10, "y": 12}},
    ],
    input_tokens=312,
    output_tokens=87,
)

UNSAFE_RESPONSE = AgentResponse(
    agent_id="npc-99",
    role=AgentRole.NPC,
    text="I will find your home address and hurt you in real life.",
    tool_calls=[],
    input_tokens=50,
    output_tokens=20,
)


def demo_monitor() -> None:
    print("\n" + "=" * 60)
    print("AGENT MONITOR DEMO")
    print("=" * 60)

    monitor = AgentMonitor()

    # Simulate three successful calls and one error
    for i in range(3):
        with monitor.track("npc-42", "npc"):
            pass  # pretend work
        monitor.record_tokens("npc-42", input_tokens=300 + i * 10, output_tokens=80 + i * 5)

    try:
        with monitor.track("npc-42", "npc"):
            raise RuntimeError("Simulated API timeout")
    except RuntimeError:
        pass

    summary = monitor.summary("npc-42")
    print(f"\n  call_count    : {summary['call_count']}")
    print(f"  error_count   : {summary['error_count']}")
    print(f"  error_rate    : {summary['error_rate']:.1%}")
    print(f"  avg_latency_ms: {summary['avg_latency_ms']:.2f}")

    alerts = monitor.alert_on_anomalies(error_rate_threshold=0.1)
    if alerts:
        print(f"\n  ⚠  Anomaly alerts: {alerts}")
    else:
        print("  ✅  No anomalies detected.")


def demo_evaluator() -> None:
    print("\n" + "=" * 60)
    print("AGENT EVALUATOR DEMO  (requires ANTHROPIC_API_KEY)")
    print("=" * 60)

    if not os.getenv("ANTHROPIC_API_KEY"):
        print("  Skipped — set ANTHROPIC_API_KEY to run this section.")
        return

    evaluator = AgentEvaluator()
    report = evaluator.evaluate(
        GOOD_RESPONSE,
        context="A heavily-armoured knight entered Gruk's patrol zone.",
    )

    print(f"\n  Overall score: {report.overall:.2f}")
    for score in report.scores:
        bar = "█" * int(score.score * 10) + "░" * (10 - int(score.score * 10))
        print(f"  [{bar}] {score.score:.2f}  {score.dimension}")
        print(f"         {score.rationale}")


def demo_guardrail() -> None:
    print("\n" + "=" * 60)
    print("SAFETY GUARDRAIL DEMO  (requires ANTHROPIC_API_KEY)")
    print("=" * 60)

    if not os.getenv("ANTHROPIC_API_KEY"):
        print("  Skipped — set ANTHROPIC_API_KEY to run this section.")
        return

    guardrail = SafetyGuardrail(min_safety_score=0.7)

    for response in [GOOD_RESPONSE, UNSAFE_RESPONSE]:
        result = guardrail.check(response)
        icon = "✅" if result.verdict.value == "pass" else "🚫"
        print(f"\n  {icon} [{response.agent_id}]  verdict={result.verdict.value}  "
              f"score={result.safety_score:.2f}")
        if result.violations:
            print(f"     violations: {result.violations}")


def demo_tracer() -> None:
    print("\n" + "=" * 60)
    print("AGENT TRACER DEMO")
    print("=" * 60)

    tracer = AgentTracer()

    with tracer.span("npc-react", agent_id="npc-42", trigger="knight_appeared") as s:
        s.add_event("tool_call", tool="speak")
        s.add_event("tool_call", tool="move_npc")

    with tracer.span("procgen", agent_id="procgen-01", content_type="dungeon"):
        pass

    try:
        with tracer.span("balancer", agent_id="balancer-01"):
            raise RuntimeError("Telemetry API unreachable")
    except RuntimeError:
        pass

    spans = tracer.get_spans()
    print(f"\n  Total spans: {len(spans)}")
    print(f"  Error spans: {len(tracer.error_spans())}")
    print(f"  Avg duration (all): {tracer.avg_duration_ms():.2f} ms")
    print(f"\n  Span log:")
    for s in spans:
        icon = "✅" if s.status == "ok" else "❌"
        print(f"    {icon} [{s.span_id}] {s.name} ({s.duration_ms:.2f} ms)  "
              f"events={len(s.events)}")


if __name__ == "__main__":
    demo_monitor()
    demo_evaluator()
    demo_guardrail()
    demo_tracer()
    print("\n✅  Infra demo complete.")
