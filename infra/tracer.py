"""
Agent Execution Tracer — Infrastructure Track
===============================================
Provides OpenTelemetry-inspired *span* tracing for agent calls, without
requiring a full OTel collector.  Traces are stored in memory and can be
exported to JSON for analysis or forwarded to a backend.

Typical usage
-------------
::

    tracer = AgentTracer()

    with tracer.span("npc-react", agent_id="npc-01", event="player attacked"):
        response = npc_agent.react("Player attacked you!")

    print(tracer.export_json())
"""

from __future__ import annotations

import json
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

import structlog

log = structlog.get_logger(__name__)


@dataclass
class Span:
    """A single traced operation."""

    span_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = ""
    agent_id: str = ""
    start_time: float = field(default_factory=time.time)
    end_time: float | None = None
    status: str = "ok"       # "ok" | "error"
    error_message: str = ""
    attributes: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)

    @property
    def duration_ms(self) -> float | None:
        if self.end_time is None:
            return None
        return (self.end_time - self.start_time) * 1000

    def add_event(self, name: str, **attrs: Any) -> None:
        self.events.append({"name": name, "timestamp": time.time(), **attrs})

    def to_dict(self) -> dict[str, Any]:
        return {
            "span_id": self.span_id,
            "name": self.name,
            "agent_id": self.agent_id,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "error_message": self.error_message,
            "attributes": self.attributes,
            "events": self.events,
        }


class AgentTracer:
    """
    Lightweight in-process tracer for agent execution.

    Parameters
    ----------
    max_spans:
        Maximum number of completed spans to retain in memory.
    """

    def __init__(self, max_spans: int = 500) -> None:
        self._spans: list[Span] = []
        self._max_spans = max_spans
        self._active: dict[str, Span] = {}   # span_id → Span (currently running)

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    @contextmanager
    def span(
        self,
        name: str,
        *,
        agent_id: str = "",
        **attributes: Any,
    ) -> Iterator[Span]:
        """
        Create and activate a span as a context manager.

        The ``Span`` object is yielded so callers can add custom events::

            with tracer.span("npc-react", agent_id="npc-01") as s:
                s.add_event("tool_call", tool="move_npc")
                response = agent.react(event)
        """
        s = Span(name=name, agent_id=agent_id, attributes=attributes)
        self._active[s.span_id] = s
        log.debug("span_start", span_id=s.span_id, name=name, agent_id=agent_id)
        try:
            yield s
        except Exception as exc:
            s.status = "error"
            s.error_message = str(exc)
            raise
        finally:
            s.end_time = time.time()
            del self._active[s.span_id]
            self._store(s)
            log.debug(
                "span_end",
                span_id=s.span_id,
                name=name,
                duration_ms=round(s.duration_ms or 0, 1),
                status=s.status,
            )

    # ------------------------------------------------------------------
    # Query / export
    # ------------------------------------------------------------------

    def get_spans(self, agent_id: str | None = None) -> list[Span]:
        """Return stored spans, optionally filtered by *agent_id*."""
        if agent_id:
            return [s for s in self._spans if s.agent_id == agent_id]
        return list(self._spans)

    def get_active_spans(self) -> list[Span]:
        """Return spans that are currently in-flight."""
        return list(self._active.values())

    def export_json(self, agent_id: str | None = None) -> str:
        """Export spans as a JSON string."""
        spans = self.get_spans(agent_id)
        return json.dumps([s.to_dict() for s in spans], indent=2)

    def error_spans(self) -> list[Span]:
        """Return all spans that ended with status='error'."""
        return [s for s in self._spans if s.status == "error"]

    def avg_duration_ms(self, name: str | None = None) -> float:
        """Average duration of completed spans, optionally filtered by name."""
        spans = [s for s in self._spans if s.duration_ms is not None]
        if name:
            spans = [s for s in spans if s.name == name]
        if not spans:
            return 0.0
        return sum(s.duration_ms for s in spans) / len(spans)  # type: ignore[misc]

    def clear(self) -> None:
        """Clear all stored spans (useful between test runs)."""
        self._spans.clear()

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _store(self, span: Span) -> None:
        self._spans.append(span)
        if len(self._spans) > self._max_spans:
            self._spans.pop(0)
