"""
Agent Monitor — Infrastructure Track
======================================
Tracks runtime metrics for every agent call: latency, token spend, error
rates, and custom counters.  Exposes a Prometheus-style summary and anomaly
alerts via structlog.
"""

from __future__ import annotations

import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

import structlog

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _metrics_to_dict(m: "AgentMetrics") -> dict[str, Any]:
    """Serialize an AgentMetrics instance including computed properties."""
    return {
        "agent_id": m.agent_id,
        "call_count": m.call_count,
        "error_count": m.error_count,
        "error_rate": m.error_rate,
        "total_latency_ms": m.total_latency_ms,
        "avg_latency_ms": m.avg_latency_ms,
        "total_input_tokens": m.total_input_tokens,
        "total_output_tokens": m.total_output_tokens,
        "avg_tokens_per_call": m.avg_tokens_per_call,
    }


@dataclass
class CallRecord:
    """Immutable record of a single agent call."""

    agent_id: str
    role: str
    latency_ms: float
    input_tokens: int
    output_tokens: int
    error: str | None = None
    timestamp: float = field(default_factory=time.time)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def succeeded(self) -> bool:
        return self.error is None


@dataclass
class AgentMetrics:
    """Aggregated metrics for one agent."""

    agent_id: str
    call_count: int = 0
    error_count: int = 0
    total_latency_ms: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0

    @property
    def error_rate(self) -> float:
        return self.error_count / self.call_count if self.call_count else 0.0

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / self.call_count if self.call_count else 0.0

    @property
    def avg_tokens_per_call(self) -> float:
        total = self.total_input_tokens + self.total_output_tokens
        return total / self.call_count if self.call_count else 0.0


class AgentMonitor:
    """
    Lightweight in-process monitor for all agents.

    Usage
    -----
    ::

        monitor = AgentMonitor()

        with monitor.track("npc-01", "npc"):
            response = npc_agent.react("Player attacked you!")

        print(monitor.summary())
    """

    def __init__(self, window_size: int = 200) -> None:
        self._window: deque[CallRecord] = deque(maxlen=window_size)
        self._metrics: dict[str, AgentMetrics] = {}

    # ------------------------------------------------------------------
    # Context manager for tracking individual calls
    # ------------------------------------------------------------------

    @contextmanager
    def track(self, agent_id: str, role: str) -> Iterator[None]:
        """Context manager that records latency and catches errors."""
        start = time.perf_counter()
        error: str | None = None
        try:
            yield
        except Exception as exc:
            error = str(exc)
            raise
        finally:
            latency_ms = (time.perf_counter() - start) * 1000
            record = CallRecord(
                agent_id=agent_id,
                role=role,
                latency_ms=latency_ms,
                input_tokens=0,   # caller can update via record_tokens()
                output_tokens=0,
                error=error,
            )
            self._record(record)

    def record_tokens(self, agent_id: str, input_tokens: int, output_tokens: int) -> None:
        """Update token counts for the most recent call of *agent_id*."""
        for rec in reversed(self._window):
            if rec.agent_id == agent_id:
                # Records are frozen dataclasses so we use object.__setattr__
                object.__setattr__(rec, "input_tokens", input_tokens)
                object.__setattr__(rec, "output_tokens", output_tokens)
                m = self._metrics[agent_id]
                m.total_input_tokens += input_tokens
                m.total_output_tokens += output_tokens
                break

    # ------------------------------------------------------------------
    # Querying
    # ------------------------------------------------------------------

    def summary(self, agent_id: str | None = None) -> dict[str, Any]:
        """Return a summary dict, optionally filtered to one agent."""
        if agent_id:
            m = self._metrics.get(agent_id)
            return _metrics_to_dict(m) if m else {}
        return {aid: _metrics_to_dict(m) for aid, m in self._metrics.items()}

    def recent_errors(self, n: int = 10) -> list[CallRecord]:
        """Return the *n* most recent error records across all agents."""
        return [r for r in reversed(self._window) if not r.succeeded][:n]

    def alert_on_anomalies(self, error_rate_threshold: float = 0.2) -> list[str]:
        """
        Emit structured log warnings and return a list of alert strings for
        any agent whose error rate exceeds *error_rate_threshold*.
        """
        alerts: list[str] = []
        for aid, m in self._metrics.items():
            if m.call_count >= 5 and m.error_rate > error_rate_threshold:
                msg = (
                    f"Agent '{aid}' error rate {m.error_rate:.1%} "
                    f"exceeds threshold {error_rate_threshold:.1%}"
                )
                log.warning("agent_anomaly", agent_id=aid, error_rate=m.error_rate)
                alerts.append(msg)
        return alerts

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _record(self, record: CallRecord) -> None:
        self._window.append(record)
        m = self._metrics.setdefault(
            record.agent_id,
            AgentMetrics(agent_id=record.agent_id),
        )
        m.call_count += 1
        m.total_latency_ms += record.latency_ms
        if not record.succeeded:
            m.error_count += 1
        log.debug(
            "agent_call_recorded",
            agent_id=record.agent_id,
            latency_ms=round(record.latency_ms, 1),
            error=record.error,
        )
