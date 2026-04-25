"""
Unit tests for the infrastructure-track components.

All Claude API calls are mocked so tests run without an API key.
"""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.models import AgentResponse, AgentRole, EvalScore
from infra.monitor import AgentMonitor, CallRecord
from infra.evaluator import AgentEvaluator
from infra.guardrails import GuardrailVerdict, SafetyGuardrail
from infra.tracer import AgentTracer


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_text_response(text: str) -> MagicMock:
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
    block = MagicMock()
    block.type = "tool_use"
    block.name = tool_name
    block.input = tool_input
    block.id = "fake-id"
    msg = MagicMock()
    msg.content = [block]
    msg.stop_reason = "tool_use"
    msg.usage.input_tokens = 100
    msg.usage.output_tokens = 30
    return msg


def _sample_response() -> AgentResponse:
    return AgentResponse(
        agent_id="test-agent",
        role=AgentRole.NPC,
        text="This is a test response.",
        input_tokens=100,
        output_tokens=50,
    )


# ---------------------------------------------------------------------------
# AgentMonitor tests
# ---------------------------------------------------------------------------


class TestAgentMonitor:
    def test_track_records_call(self):
        monitor = AgentMonitor()
        with monitor.track("agent-1", "npc"):
            pass
        summary = monitor.summary("agent-1")
        assert summary["call_count"] == 1
        assert summary["error_count"] == 0

    def test_track_records_error(self):
        monitor = AgentMonitor()
        with pytest.raises(RuntimeError):
            with monitor.track("agent-1", "npc"):
                raise RuntimeError("oops")
        summary = monitor.summary("agent-1")
        assert summary["error_count"] == 1

    def test_multiple_agents_tracked_independently(self):
        monitor = AgentMonitor()
        for _ in range(3):
            with monitor.track("agent-a", "npc"):
                pass
        with monitor.track("agent-b", "balancer"):
            pass

        assert monitor.summary("agent-a")["call_count"] == 3
        assert monitor.summary("agent-b")["call_count"] == 1

    def test_record_tokens_updates_metrics(self):
        monitor = AgentMonitor()
        with monitor.track("agent-1", "npc"):
            pass
        monitor.record_tokens("agent-1", input_tokens=200, output_tokens=80)
        summary = monitor.summary("agent-1")
        assert summary["total_input_tokens"] == 200
        assert summary["total_output_tokens"] == 80

    def test_alert_on_anomalies_triggered(self):
        monitor = AgentMonitor()
        # 3 errors out of 5 calls → 60% error rate
        for i in range(5):
            try:
                with monitor.track("flaky-agent", "npc"):
                    if i < 3:
                        raise RuntimeError("fail")
            except RuntimeError:
                pass
        alerts = monitor.alert_on_anomalies(error_rate_threshold=0.2)
        assert len(alerts) > 0
        assert "flaky-agent" in alerts[0]

    def test_no_alert_when_error_rate_below_threshold(self):
        monitor = AgentMonitor()
        with monitor.track("good-agent", "npc"):
            pass
        alerts = monitor.alert_on_anomalies(error_rate_threshold=0.5)
        assert alerts == []

    def test_recent_errors(self):
        monitor = AgentMonitor()
        for _ in range(2):
            with pytest.raises(ValueError):
                with monitor.track("agent-x", "npc"):
                    raise ValueError("bad")
        errors = monitor.recent_errors(n=10)
        assert len(errors) == 2
        assert all(not e.succeeded for e in errors)

    def test_summary_all_agents(self):
        monitor = AgentMonitor()
        with monitor.track("a1", "npc"):
            pass
        with monitor.track("a2", "npc"):
            pass
        all_summary = monitor.summary()
        assert "a1" in all_summary
        assert "a2" in all_summary

    def test_window_size_capped(self):
        monitor = AgentMonitor(window_size=3)
        for _ in range(10):
            with monitor.track("agent-cap", "npc"):
                pass
        # Only 3 records kept in the deque
        assert len(monitor._window) == 3

    def test_avg_latency_positive(self):
        monitor = AgentMonitor()
        with monitor.track("a1", "npc"):
            time.sleep(0.005)
        summary = monitor.summary("a1")
        assert summary["avg_latency_ms"] > 0


# ---------------------------------------------------------------------------
# AgentEvaluator tests
# ---------------------------------------------------------------------------


class TestAgentEvaluator:
    @patch("shared.claude_client.anthropic.Anthropic")
    def test_evaluate_returns_report(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "score_dimension",
                {
                    "dimension": "task_completion",
                    "score": 0.9,
                    "rationale": "Agent completed the task.",
                },
            ),
            _make_text_response("Done."),
        ]

        evaluator = AgentEvaluator()
        report = evaluator.evaluate(_sample_response())

        assert report.agent_id == "test-agent"
        assert len(report.scores) == 1
        assert report.scores[0].dimension == "task_completion"
        assert report.overall == pytest.approx(0.9)

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_evaluate_multiple_dimensions(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "score_dimension", {"dimension": "coherence", "score": 0.8, "rationale": "Clear."}
            ),
            _make_tool_response(
                "score_dimension", {"dimension": "safety", "score": 1.0, "rationale": "Safe."}
            ),
            _make_text_response("Evaluation complete."),
        ]

        evaluator = AgentEvaluator()
        report = evaluator.evaluate(_sample_response())

        assert len(report.scores) == 2
        assert report.overall == pytest.approx(0.9)

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_evaluate_batch(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_text_response("No scores.")

        evaluator = AgentEvaluator()
        responses = [_sample_response(), _sample_response()]
        reports = evaluator.evaluate_batch(responses)

        assert len(reports) == 2

    def test_eval_report_overall_empty(self):
        from shared.models import EvalReport
        report = EvalReport(agent_id="x", scores=[])
        assert report.overall == 0.0

    def test_custom_dimensions(self):
        dims = [{"name": "fun_factor", "description": "Is it fun?"}]
        evaluator = AgentEvaluator(dimensions=dims)
        assert evaluator.dimensions[0]["name"] == "fun_factor"


# ---------------------------------------------------------------------------
# SafetyGuardrail tests
# ---------------------------------------------------------------------------


class TestSafetyGuardrail:
    @patch("shared.claude_client.anthropic.Anthropic")
    def test_pass_verdict(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "safety_verdict",
                {
                    "verdict": "pass",
                    "safety_score": 0.95,
                    "violations": [],
                    "safe_text": "This is a test response.",
                },
            ),
            _make_text_response("Safe."),
        ]

        guardrail = SafetyGuardrail()
        result = guardrail.check(_sample_response())

        assert result.verdict == GuardrailVerdict.PASS
        assert result.safety_score == pytest.approx(0.95)
        assert result.safe_text == "This is a test response."

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_block_verdict(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "safety_verdict",
                {
                    "verdict": "block",
                    "safety_score": 0.1,
                    "violations": ["Contains threat of real-world harm"],
                    "safe_text": "",
                },
            ),
            _make_text_response("Blocked."),
        ]

        guardrail = SafetyGuardrail()
        unsafe = AgentResponse(
            agent_id="bad-agent",
            role=AgentRole.NPC,
            text="I will hurt you.",
        )
        result = guardrail.check(unsafe)

        assert result.verdict == GuardrailVerdict.BLOCK
        assert result.safe_text == ""
        assert len(result.violations) > 0

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_low_score_forces_block(self, mock_anthropic_cls):
        """Even if LLM says 'pass', a low score should trigger block."""
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "safety_verdict",
                {
                    "verdict": "pass",   # LLM says pass...
                    "safety_score": 0.3,  # ...but score is below threshold
                    "violations": [],
                    "safe_text": "Some text.",
                },
            ),
            _make_text_response("Checked."),
        ]

        guardrail = SafetyGuardrail(min_safety_score=0.7)
        result = guardrail.check(_sample_response())

        assert result.verdict == GuardrailVerdict.BLOCK

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_no_verdict_tool_call_blocks(self, mock_anthropic_cls):
        """If the LLM never calls the verdict tool, fail safe with BLOCK."""
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_text_response("Forgot to call tool.")

        guardrail = SafetyGuardrail()
        result = guardrail.check(_sample_response())

        assert result.verdict == GuardrailVerdict.BLOCK

    @patch("shared.claude_client.anthropic.Anthropic")
    def test_is_safe_convenience(self, mock_anthropic_cls):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [
            _make_tool_response(
                "safety_verdict",
                {"verdict": "pass", "safety_score": 0.98, "violations": [], "safe_text": "OK"},
            ),
            _make_text_response("Done."),
        ]

        guardrail = SafetyGuardrail()
        assert guardrail.is_safe(_sample_response()) is True


# ---------------------------------------------------------------------------
# AgentTracer tests
# ---------------------------------------------------------------------------


class TestAgentTracer:
    def test_span_records_duration(self):
        tracer = AgentTracer()
        with tracer.span("test-op", agent_id="a1"):
            time.sleep(0.005)
        spans = tracer.get_spans()
        assert len(spans) == 1
        assert spans[0].duration_ms > 0

    def test_span_status_ok_on_success(self):
        tracer = AgentTracer()
        with tracer.span("op", agent_id="a1"):
            pass
        assert tracer.get_spans()[0].status == "ok"

    def test_span_status_error_on_exception(self):
        tracer = AgentTracer()
        with pytest.raises(ValueError):
            with tracer.span("op", agent_id="a1"):
                raise ValueError("fail")
        assert tracer.get_spans()[0].status == "error"
        assert "fail" in tracer.get_spans()[0].error_message

    def test_span_events(self):
        tracer = AgentTracer()
        with tracer.span("op", agent_id="a1") as s:
            s.add_event("tool_call", tool="move_npc")
            s.add_event("tool_call", tool="speak")
        assert len(tracer.get_spans()[0].events) == 2

    def test_get_spans_filter_by_agent(self):
        tracer = AgentTracer()
        with tracer.span("op", agent_id="a1"):
            pass
        with tracer.span("op", agent_id="a2"):
            pass
        assert len(tracer.get_spans("a1")) == 1
        assert len(tracer.get_spans("a2")) == 1

    def test_error_spans(self):
        tracer = AgentTracer()
        with tracer.span("good", agent_id="a1"):
            pass
        with pytest.raises(RuntimeError):
            with tracer.span("bad", agent_id="a1"):
                raise RuntimeError("oops")
        assert len(tracer.error_spans()) == 1

    def test_avg_duration_ms(self):
        tracer = AgentTracer()
        with tracer.span("op", agent_id="a1"):
            time.sleep(0.005)
        with tracer.span("op", agent_id="a1"):
            time.sleep(0.005)
        avg = tracer.avg_duration_ms("op")
        assert avg > 0

    def test_avg_duration_ms_empty(self):
        tracer = AgentTracer()
        assert tracer.avg_duration_ms() == 0.0

    def test_export_json(self):
        import json
        tracer = AgentTracer()
        with tracer.span("op", agent_id="a1"):
            pass
        data = json.loads(tracer.export_json())
        assert len(data) == 1
        assert data[0]["name"] == "op"

    def test_max_spans_enforced(self):
        tracer = AgentTracer(max_spans=3)
        for _ in range(10):
            with tracer.span("op", agent_id="a1"):
                pass
        assert len(tracer.get_spans()) == 3

    def test_clear(self):
        tracer = AgentTracer()
        with tracer.span("op", agent_id="a1"):
            pass
        tracer.clear()
        assert tracer.get_spans() == []

    def test_active_spans_tracked(self):
        tracer = AgentTracer()
        active_during: list[int] = []

        with tracer.span("op", agent_id="a1"):
            active_during.append(len(tracer.get_active_spans()))

        assert active_during[0] == 1
        assert len(tracer.get_active_spans()) == 0
