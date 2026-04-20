"""Bridge between bitidea-agent's ``AIAgent`` (sync, callback-based) and the
FastAPI SSE stream (async, per-request).

Design
------
``AIAgent.run_conversation`` is a fully synchronous method that drives an LLM
conversation in the **calling thread** and invokes user-supplied callbacks as
events occur (token deltas, tool progress, thinking traces, step boundaries).

FastAPI SSE handlers are ``async`` generators on the event loop thread. To
bridge the two worlds we:

1. Run ``run_conversation`` inside a ``ThreadPoolExecutor`` worker thread.
2. Every callback pushes an ``(event, data)`` tuple onto an ``asyncio.Queue``
   using ``asyncio.run_coroutine_threadsafe(queue.put(...), loop)``.
3. The SSE generator drains that queue and yields formatted SSE frames until
   the worker thread finishes and the sentinel ``("done", {})`` arrives.

Approval flow
-------------
bitidea-agent's approval system lives in ``tools.approval``. The mechanism
we use is:

* Set ``BITIDEA_GATEWAY_SESSION`` env var for the worker thread's context so
  dangerous commands are routed through ``check_all_command_guards`` in
  gateway mode.
* Register a ``notify_cb`` via ``register_gateway_notify(session_key, cb)``
  that fires when approval is needed. That callback publishes an
  ``approval_request`` SSE event.
* The frontend ``POST /approval`` resolves the waiting thread via
  ``resolve_gateway_approval(session_key, choice)`` — "once" / "always" /
  "deny".

The v0.2 UI surfaces *allow* + *remember (60s)*. We translate:

  * ``allow=true,  remember=false`` -> ``"once"``
  * ``allow=true,  remember=true``  -> cache in the 60s approval cache AND
    send ``"once"`` to the underlying agent (we do our own TTL cache rather
    than using the agent's permanent allowlist, so checkbox state stays
    ephemeral the way users expect).
  * ``allow=false``                 -> ``"deny"``

The 60-second cache is keyed on ``(tool_name, sha256(json(args)))`` and short-
circuits the notify callback entirely for repeat calls.

Deviations from the briefing
----------------------------
* The briefing claimed ``AIAgent`` accepts ``approval_callback`` and
  ``state_dir`` kwargs. Neither exists — see ``run_agent.py`` lines 552-610.
  We use the ``BITIDEA_GATEWAY_SESSION`` + ``register_gateway_notify`` API
  instead, and set ``BITIDEA_HOME`` per-process to point at
  ``~/.bitidea-desktop/agent-state`` so persisted sessions stay isolated
  from the standalone CLI's ``~/.bitidea/``.
* Callback signatures are adjusted to match the real ones in run_agent.py:
  - ``tool_progress_callback(event_type, name, preview, args)``
  - ``step_callback(api_call_count, prev_tools)``
  - ``status_callback(kind, message)``
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Literal, Optional

logger = logging.getLogger("sidecar.agent_bridge")


# ---------------------------------------------------------------------------
# Severity classification
# ---------------------------------------------------------------------------

Severity = Literal["read", "write", "destructive", "network", "unknown"]

_READ_TOOLS = {"read_file", "list_files", "grep", "glob"}
_WRITE_TOOLS = {"write_file", "edit_file", "create_file"}
_DESTRUCTIVE_TOOLS = {"delete_file", "rmdir"}
_NETWORK_TOOLS = {"http_get", "http_post", "fetch"}

_SHELL_DESTRUCTIVE_PREFIXES = (
    "rm ", "rm\t",
    "mv ", "mv\t",
    "dd ", "dd\t",
)
_SHELL_DESTRUCTIVE_EXACT = {"rm", "mv", "dd"}
_SHELL_NETWORK_FIRST_TOKENS = {"curl", "wget", "ssh", "scp", "nc", "telnet"}
_SHELL_WRITE_FIRST_TOKENS = {"mkdir", "touch", "cp", "vim", "nano", "code"}
_SHELL_READ_FIRST_TOKENS = {"ls", "cat", "head", "tail", "grep", "pwd", "echo", "which"}


def _classify_shell(command: str) -> Severity:
    """Classify a shell command by inspecting its leading token(s)."""
    if not command or not isinstance(command, str):
        return "unknown"
    stripped = command.strip()
    if not stripped:
        return "unknown"

    # Destructive git patterns (multi-word).
    if stripped.startswith("git reset --hard"):
        return "destructive"
    if stripped.startswith("git push") and (
        " --force" in stripped or " -f " in stripped or stripped.endswith(" -f")
    ):
        return "destructive"

    # Destructive prefix tokens (rm, mv, dd).
    first = stripped.split(None, 1)[0]
    if first in _SHELL_DESTRUCTIVE_EXACT:
        return "destructive"
    if any(stripped.startswith(p) for p in _SHELL_DESTRUCTIVE_PREFIXES):
        return "destructive"

    # sed -i is a write (in-place file edit); bare sed would be read but we
    # lump all under write for safety.
    if first == "sed":
        return "write"

    if first in _SHELL_NETWORK_FIRST_TOKENS:
        return "network"
    if first in _SHELL_WRITE_FIRST_TOKENS:
        return "write"
    if first in _SHELL_READ_FIRST_TOKENS:
        return "read"

    return "unknown"


def classify_tool_severity(tool_name: str, args: Dict[str, Any]) -> Severity:
    """Return a severity tier for an approval request.

    Bias: unknown categories render at write tier in the UI. We would rather
    prompt unnecessarily than silently miss a dangerous call.
    """
    name = (tool_name or "").strip()

    if name in _READ_TOOLS:
        return "read"
    if name in _WRITE_TOOLS:
        return "write"
    if name in _DESTRUCTIVE_TOOLS:
        return "destructive"
    if name in _NETWORK_TOOLS:
        return "network"

    # Shell-like tool — parse the command.
    if name in {"terminal", "shell", "bash", "execute_command"}:
        cmd = args.get("command") if isinstance(args, dict) else None
        return _classify_shell(cmd if isinstance(cmd, str) else "")

    # URL-in-args fallback for anything else.
    if isinstance(args, dict):
        for v in args.values():
            if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")):
                return "network"

    return "unknown"


# ---------------------------------------------------------------------------
# Approval state
# ---------------------------------------------------------------------------


@dataclass
class _PendingApproval:
    """One approval request waiting for the frontend to respond."""

    request_id: str
    tool_name: str
    args: Dict[str, Any]
    event: threading.Event = field(default_factory=threading.Event)
    # "once" | "session" | "always" | "deny" — matches bitidea approval contract.
    result: str = "deny"
    remember: bool = False
    created_at: float = field(default_factory=time.monotonic)


@dataclass
class _RememberEntry:
    expires_at: float


class ApprovalRegistry:
    """Process-wide registry of pending approvals + 60s remember cache."""

    REMEMBER_TTL = 60.0
    TIMEOUT_SECONDS = 120.0

    def __init__(self) -> None:
        self._pending: Dict[str, _PendingApproval] = {}
        self._remember: Dict[str, _RememberEntry] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _cache_key(tool_name: str, args: Dict[str, Any]) -> str:
        try:
            raw = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            raw = repr(args)
        h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
        return f"{tool_name}::{h}"

    # ---- write side --------------------------------------------------------

    def register_pending(self, tool_name: str, args: Dict[str, Any]) -> _PendingApproval:
        req = _PendingApproval(
            request_id=uuid.uuid4().hex,
            tool_name=tool_name,
            args=args or {},
        )
        with self._lock:
            self._pending[req.request_id] = req
        return req

    def resolve(self, request_id: str, allow: bool, remember: bool) -> bool:
        """Called from the /approval HTTP handler. Returns True if we matched."""
        with self._lock:
            req = self._pending.pop(request_id, None)
        if req is None:
            return False
        req.remember = bool(remember)
        req.result = "once" if allow else "deny"
        if allow and remember:
            key = self._cache_key(req.tool_name, req.args)
            with self._lock:
                self._remember[key] = _RememberEntry(
                    expires_at=time.monotonic() + self.REMEMBER_TTL,
                )
        req.event.set()
        return True

    def cancel_all(self) -> None:
        """Deny every pending approval (used on agent teardown / cancel)."""
        with self._lock:
            pending = list(self._pending.values())
            self._pending.clear()
        for req in pending:
            req.result = "deny"
            req.event.set()

    # ---- read side ---------------------------------------------------------

    def check_remember(
        self, tool_name: str, args: Dict[str, Any]
    ) -> "tuple[bool, Optional[float]]":
        """Return (hit, expires_at_monotonic). On miss both are (False, None)."""
        key = self._cache_key(tool_name, args)
        now = time.monotonic()
        with self._lock:
            entry = self._remember.get(key)
            if entry is None:
                return (False, None)
            if entry.expires_at <= now:
                self._remember.pop(key, None)
                return (False, None)
            return (True, entry.expires_at)


# Process-wide singleton.
APPROVALS = ApprovalRegistry()


# ---------------------------------------------------------------------------
# SSE formatting
# ---------------------------------------------------------------------------


def _sse(event: str, data: Dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode(
        "utf-8"
    )


# ---------------------------------------------------------------------------
# Agent state dir
# ---------------------------------------------------------------------------


def _agent_state_dir() -> str:
    """Return the isolated bitidea-desktop agent state directory.

    Exported via the ``BITIDEA_HOME`` env var so bitidea-agent's config /
    session DB live under ``~/.bitidea-desktop/agent-state/`` instead of
    the standalone CLI's default ``~/.bitidea/``.
    """
    home = os.path.expanduser("~/.bitidea-desktop/agent-state")
    os.makedirs(home, mode=0o700, exist_ok=True)
    try:
        os.chmod(home, 0o700)
    except OSError:
        pass
    return home


def _infer_base_url(provider: str, base_url: Optional[str]) -> str:
    if provider == "openai":
        return "https://api.openai.com"
    if provider == "openrouter":
        return "https://openrouter.ai/api"
    if provider == "anthropic":
        return "https://api.anthropic.com"
    if provider == "custom":
        if not base_url:
            raise ValueError("custom provider requires base_url")
        return base_url.rstrip("/")
    raise ValueError(f"unknown provider: {provider!r}")


def _openai_compatible_base(provider: str, base_url: str) -> str:
    """bitidea-agent expects the base_url to already include the ``/v1`` path
    for OpenAI-style endpoints. Normalise here."""
    url = base_url.rstrip("/")
    if provider in ("openai", "openrouter", "custom"):
        if not url.endswith("/v1"):
            url = f"{url}/v1"
    return url


# ---------------------------------------------------------------------------
# Main bridge
# ---------------------------------------------------------------------------


class AgentRunner:
    """One-shot wrapper that runs ``AIAgent.run_conversation`` and streams
    SSE events as the agent emits callbacks.

    The caller obtains ``stream()`` (an async iterator of SSE byte frames)
    and awaits it inside a FastAPI ``StreamingResponse``.
    """

    # Agent loops on an executor thread — 5 minutes upper bound so a hung
    # provider never leaks the thread indefinitely.
    HARD_TIMEOUT_SECONDS = 600.0

    def __init__(
        self,
        *,
        provider: str,
        model: str,
        api_key: str,
        base_url: Optional[str],
        messages: List[Dict[str, str]],
    ) -> None:
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.base_url = _openai_compatible_base(
            provider, _infer_base_url(provider, base_url)
        )
        self.messages = messages

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._queue: Optional[asyncio.Queue[bytes]] = None
        self._sentinel = object()
        self._session_key = f"bitidea-desktop:{uuid.uuid4().hex[:16]}"
        self._finished = threading.Event()

        # FIFO of (command, expires_at_epoch_ms) pairs — populated when the
        # remember cache short-circuits a notify(), consumed by the next
        # matching tool_start event so the ToolCard can render an
        # auto-allowed badge with a live countdown.
        self._recent_auto_allowed: List["tuple[str, int]"] = []
        self._recent_lock = threading.Lock()

    # ---- callback factory --------------------------------------------------

    def _push(self, event: str, data: Dict[str, Any]) -> None:
        """Push an SSE frame onto the queue from *any* thread."""
        loop = self._loop
        queue = self._queue
        if loop is None or queue is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(queue.put(_sse(event, data)), loop)
        except RuntimeError:
            # Loop shut down before we could enqueue — drop silently.
            pass

    def _make_callbacks(self) -> Dict[str, Any]:
        """Build the callback bundle AIAgent expects.

        Each callback runs on the agent's worker thread and forwards the
        event into the asyncio queue.
        """
        tool_ids: Dict[str, str] = {}

        def stream_delta(delta: Any) -> None:
            # AIAgent sends None at end-of-stream — ignore those.
            if isinstance(delta, str) and delta:
                self._push("token", {"text": delta})

        def tool_progress(
            event_type: str,
            name: str = "",
            preview: str = "",
            args: Any = None,
            **_kwargs: Any,
        ) -> None:
            if event_type != "tool.started":
                return
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except (json.JSONDecodeError, TypeError):
                    args = {"raw": args}
            if not isinstance(args, dict):
                args = {}
            tool_id = uuid.uuid4().hex
            tool_ids[name] = tool_id  # last-one-wins; step_cb matches by name
            # Check whether this invocation was pre-approved via the remember
            # cache — consume the matching entry if so.
            auto_allowed = False
            allowed_until_ms: Optional[int] = None
            cmd = args.get("command") if isinstance(args, dict) else None
            if isinstance(cmd, str) and cmd:
                with self._recent_lock:
                    for idx, (cached_cmd, until_ms) in enumerate(self._recent_auto_allowed):
                        if cached_cmd == cmd:
                            auto_allowed = True
                            allowed_until_ms = until_ms
                            self._recent_auto_allowed.pop(idx)
                            break
            frame: Dict[str, Any] = {
                "id": tool_id,
                "name": name,
                "args": args,
                "preview": preview or "",
            }
            if auto_allowed:
                frame["auto_allowed"] = True
                if allowed_until_ms is not None:
                    frame["allowed_until_ms"] = allowed_until_ms
            self._push("tool_start", frame)

        def thinking(text: str) -> None:
            if text:
                self._push("thinking", {"text": text})

        def step(api_call_count: int, prev_tools: Any = None) -> None:
            # We don't know "total" steps ahead of time — pass n and let the UI
            # render "STEP N" without a denominator.
            self._push("step", {"n": int(api_call_count), "total": 0})
            # Emit tool_result for every completed tool we know the id of.
            if isinstance(prev_tools, list):
                for info in prev_tools:
                    tool_name: Optional[str] = None
                    result: Any = None
                    ok = True
                    if isinstance(info, dict):
                        tool_name = info.get("name") or info.get("function_name")
                        result = info.get("result") or info.get("output")
                        ok = bool(info.get("ok", True))
                    elif isinstance(info, str):
                        tool_name = info
                    tool_id = tool_ids.pop(tool_name or "", None)
                    if tool_id is None:
                        continue
                    summary = ""
                    truncated = False
                    if result is not None:
                        summary = str(result)
                        if len(summary) > 2000:
                            summary = summary[:2000]
                            truncated = True
                    self._push(
                        "tool_result",
                        {
                            "id": tool_id,
                            "ok": ok,
                            "summary": summary,
                            "truncated": truncated,
                        },
                    )

        def status(kind: str, message: str = "") -> None:
            text = message if message else (kind if kind else "")
            if text:
                self._push("status", {"text": str(text)})

        return dict(
            stream_delta_callback=stream_delta,
            tool_progress_callback=tool_progress,
            thinking_callback=thinking,
            step_callback=step,
            status_callback=status,
        )

    # ---- approval notify ---------------------------------------------------

    def _make_notify_cb(self):
        """Notification callback registered with ``tools.approval``.

        Fires on the agent thread whenever a dangerous command needs
        approval. We short-circuit via the 60s remember cache, otherwise
        publish an ``approval_request`` SSE frame and block the agent
        thread until ``/approval`` resolves it (or 120s timeout -> deny).
        """

        def notify(approval_data: Dict[str, Any]) -> None:
            tool_name = approval_data.get("description") or "shell-command"
            command = approval_data.get("command", "")
            args = {
                "command": command,
                "description": tool_name,
                "pattern_key": approval_data.get("pattern_key"),
            }
            # 60s remember cache short-circuit — auto-resolve the underlying
            # approval entry immediately.
            hit, expires_at_mono = APPROVALS.check_remember(tool_name, args)
            if hit:
                from tools import approval as _approval

                _approval.resolve_gateway_approval(self._session_key, "once")
                # Translate monotonic expiry to wall-clock epoch ms for the UI.
                if expires_at_mono is not None:
                    delta = expires_at_mono - time.monotonic()
                    until_ms = int((time.time() + max(0.0, delta)) * 1000)
                else:
                    until_ms = int(time.time() * 1000)
                with self._recent_lock:
                    self._recent_auto_allowed.append((command, until_ms))
                    # Cap the FIFO so it never grows unbounded.
                    if len(self._recent_auto_allowed) > 8:
                        self._recent_auto_allowed.pop(0)
                self._push(
                    "status",
                    {"text": f"(auto-allowed cached approval: {tool_name})"},
                )
                return

            req = APPROVALS.register_pending(tool_name, args)
            preview = command if len(command) < 400 else command[:400] + "…"
            severity = classify_tool_severity(tool_name, args)
            self._push(
                "approval_request",
                {
                    "request_id": req.request_id,
                    "tool_name": tool_name,
                    "args": args,
                    "preview": preview,
                    "severity": severity,
                },
            )
            # Block the agent thread until resolved or 120s expires.
            if not req.event.wait(timeout=APPROVALS.TIMEOUT_SECONDS):
                from tools import approval as _approval

                APPROVALS._pending.pop(req.request_id, None)  # type: ignore[attr-defined]
                _approval.resolve_gateway_approval(self._session_key, "deny")
                self._push(
                    "error",
                    {"message": f"Approval timed out after {int(APPROVALS.TIMEOUT_SECONDS)}s — auto-denied."},
                )
                return
            # Bridge our decision back to the agent's gateway queue.
            from tools import approval as _approval

            _approval.resolve_gateway_approval(self._session_key, req.result)

        return notify

    # ---- worker thread -----------------------------------------------------

    def _run_agent_sync(self) -> None:
        """Runs in a worker thread. Instantiates AIAgent and drives it."""
        try:
            # Route bitidea-agent state away from ~/.bitidea/ to keep Desktop
            # isolated from the standalone CLI.
            os.environ["BITIDEA_HOME"] = _agent_state_dir()
            # Engage gateway-style approval routing so dangerous commands ask
            # us instead of prompting on stdin.
            os.environ["BITIDEA_GATEWAY_SESSION"] = self._session_key

            from tools import approval as _approval
            from run_agent import AIAgent
            from tools.approval import (
                register_gateway_notify,
                set_current_session_key,
                unregister_gateway_notify,
            )

            register_gateway_notify(self._session_key, self._make_notify_cb())
            token = set_current_session_key(self._session_key)

            try:
                cb = self._make_callbacks()
                agent_provider = (
                    "anthropic" if self.provider == "anthropic" else self.provider
                )
                # AIAgent accepts (base_url, api_key, provider, model, ...).
                # All toolsets enabled (enabled_toolsets=None).
                agent = AIAgent(
                    base_url=self.base_url,
                    api_key=self.api_key,
                    provider=agent_provider,
                    model=self.model,
                    quiet_mode=True,
                    skip_context_files=True,
                    save_trajectories=False,
                    session_id=self._session_key,
                    **cb,
                )
                # Drain incoming history — last message is the new user prompt,
                # everything before is conversation context.
                if not self.messages:
                    raise ValueError("empty messages list")
                *history, last = self.messages
                if last["role"] != "user":
                    raise ValueError("last message must be role=user")
                history_dicts: List[Dict[str, Any]] = [
                    {"role": m["role"], "content": m["content"]} for m in history
                ]
                agent.run_conversation(
                    user_message=last["content"],
                    conversation_history=history_dicts or None,
                )
            finally:
                try:
                    _approval.reset_current_session_key(token)
                except Exception:
                    pass
                try:
                    unregister_gateway_notify(self._session_key)
                except Exception:
                    pass
        except Exception as exc:  # noqa: BLE001 — surface to UI
            logger.exception("agent run failed")
            self._push("error", {"message": f"{type(exc).__name__}: {exc}"})
        finally:
            # Deny anything still waiting so no thread leaks.
            APPROVALS.cancel_all()
            self._push("done", {})
            self._finished.set()

    # ---- public stream -----------------------------------------------------

    async def stream(self) -> AsyncIterator[bytes]:
        """Run the agent and yield SSE frames until it finishes."""
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()

        worker = threading.Thread(
            target=self._run_agent_sync,
            name=f"agent-{self._session_key[-8:]}",
            daemon=True,
        )
        worker.start()

        deadline = time.monotonic() + self.HARD_TIMEOUT_SECONDS

        try:
            while True:
                timeout = max(0.1, deadline - time.monotonic())
                try:
                    frame = await asyncio.wait_for(self._queue.get(), timeout=timeout)
                except asyncio.TimeoutError:
                    yield _sse(
                        "error",
                        {
                            "message": f"agent exceeded {int(self.HARD_TIMEOUT_SECONDS)}s hard timeout"
                        },
                    )
                    yield _sse("done", {})
                    return
                yield frame
                # `done` is always the last frame the worker emits.
                if b"event: done" in frame[:32]:
                    return
        finally:
            # Stream consumer went away (user aborted / webview navigated).
            # Signal any pending approvals so the worker thread doesn't hang.
            APPROVALS.cancel_all()
