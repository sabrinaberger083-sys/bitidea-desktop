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

The v0.2 UI surfaces *allow* + approval scope. We translate:

  * ``allow=true,  mode="once"``     -> ``"once"``
  * ``allow=true,  mode="remember"`` -> cache in the 60s approval cache AND
    send ``"once"`` to the underlying agent (we do our own TTL cache rather
    than using the agent's permanent allowlist, so checkbox state stays
    ephemeral the way users expect).
  * ``allow=true,  mode="always"``   -> ``"always"`` to the underlying
    agent, without touching the 60-second cache.
  * ``allow=false``                  -> ``"deny"``

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
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
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
ApprovalMode = Literal["once", "remember", "always"]

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
_ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
_STATUS_WHITESPACE_RE = re.compile(r"\s+")
_STATUS_LEADING_SYMBOLS_RE = re.compile(r"^[^A-Za-z]+")
_STATUS_THINKING_VERBS = {
    "pondering",
    "contemplating",
    "musing",
    "cogitating",
    "ruminating",
    "deliberating",
    "mulling",
    "reflecting",
    "processing",
    "reasoning",
    "analyzing",
    "computing",
    "synthesizing",
    "formulating",
    "brainstorming",
}
_STATUS_MAX_LEN = 220


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


def sanitize_status_text(text: Any) -> str:
    """Normalize internal agent status text for frontend display."""
    raw = _ANSI_ESCAPE_RE.sub("", str(text or "")).replace("\r", "\n").strip()
    if not raw:
        return ""

    collapsed = _STATUS_WHITESPACE_RE.sub(" ", raw)
    lowered = collapsed.lower()

    if lowered.startswith("(auto-allowed cached approval:"):
        return "Using remembered approval"

    stripped = _STATUS_LEADING_SYMBOLS_RE.sub("", lowered)
    first_token = stripped.split(None, 1)[0].rstrip(".…!?,;:") if stripped else ""
    if first_token in _STATUS_THINKING_VERBS:
        return "Thinking..."

    if len(collapsed) > _STATUS_MAX_LEN:
        return collapsed[: _STATUS_MAX_LEN - 3].rstrip() + "..."
    return collapsed


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
        # Prefer the raw command string when present — this is the only field
        # shared across both cache call sites (notify's normalized dict vs.
        # tool_progress's raw tool args), so keying on it lets reads from one
        # side hit writes from the other.
        if isinstance(args, dict):
            cmd = args.get("command")
            if isinstance(cmd, str) and cmd:
                h = hashlib.sha256(cmd.encode("utf-8")).hexdigest()[:32]
                return f"cmd::{h}"
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

    def resolve(
        self,
        request_id: str,
        allow: bool,
        remember: bool = False,
        mode: Optional[ApprovalMode] = None,
    ) -> bool:
        """Called from the /approval HTTP handler. Returns True if we matched."""
        with self._lock:
            req = self._pending.pop(request_id, None)
        if req is None:
            return False
        selected_mode: ApprovalMode = mode or ("remember" if remember else "once")
        if selected_mode not in {"once", "remember", "always"}:
            selected_mode = "once"
        req.remember = allow and selected_mode == "remember"
        if not allow:
            req.result = "deny"
        elif selected_mode == "always":
            req.result = "always"
        else:
            req.result = "once"
        if allow and selected_mode == "remember":
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
_VISION_ANALYSIS_CACHE: Dict[str, str] = {}
_VISION_CACHE_LOCK = threading.Lock()
_SYNCED_SKILL_HOMES: set[str] = set()
_SYNCED_SKILL_HOMES_LOCK = threading.Lock()


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


def _sync_agent_skills_once(bitidea_home: str) -> None:
    """Mirror CLI/gateway startup behavior for Desktop's isolated BITIDEA_HOME.

    The Hermes/bitidea-agent CLI and gateway call ``sync_skills()`` on startup,
    but the Desktop sidecar uses its own isolated ``BITIDEA_HOME`` and never did
    that sync. Result: ``skills_list`` saw an empty ``~/.bitidea-desktop/.../skills``
    directory even though the backend ships bundled skills.
    """
    with _SYNCED_SKILL_HOMES_LOCK:
        if bitidea_home in _SYNCED_SKILL_HOMES:
            return

    try:
        from tools.skills_sync import sync_skills

        result = sync_skills(quiet=True)
        copied = len(result.get("copied") or [])
        updated = len(result.get("updated") or [])
        if copied or updated:
            logger.info(
                "Synced bundled skills into %s (+%d / ↑%d)",
                bitidea_home,
                copied,
                updated,
            )
    except Exception:
        logger.exception("failed to sync bundled skills for %s", bitidea_home)
        return

    with _SYNCED_SKILL_HOMES_LOCK:
        _SYNCED_SKILL_HOMES.add(bitidea_home)


def _infer_base_url(provider: str, base_url: Optional[str]) -> str:
    if base_url:
        return base_url.rstrip("/")
    from .server import _PROVIDER_BASE_URLS
    url = _PROVIDER_BASE_URLS.get(provider)
    if url:
        return url
    if provider == "custom":
        raise ValueError("custom provider requires base_url")
    raise ValueError(f"unknown provider: {provider!r}")


def _openai_compatible_base(provider: str, base_url: str) -> str:
    """bitidea-agent expects the base_url to already include a versioned path
    for OpenAI-style endpoints. Normalise here."""
    import re as _re
    url = base_url.rstrip("/")
    if provider != "anthropic" and not _re.search(r"/v\d", url):
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
    IMAGE_ANALYSIS_TIMEOUT_SECONDS = 180.0

    def __init__(
        self,
        *,
        provider: str,
        model: str,
        api_key: str,
        base_url: Optional[str],
        messages: List[Dict[str, Any]],
        project_path: Optional[str] = None,
        system_prompt: Optional[str] = None,
        ui_lang: Optional[str] = None,
    ) -> None:
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.base_url = _openai_compatible_base(
            provider, _infer_base_url(provider, base_url)
        )
        self.messages = messages
        self.project_path = project_path
        self.ui_lang = ui_lang or "en"
        base_system_prompt = system_prompt or (
            "你是 Bitidea Agent，由小小思路信息科技有限公司开发的智能 AI 助手。"
            "当用户使用中文时，始终用流畅自然的中文回复，不要出现截断、乱码或不完整的句子。"
            "回答要准确、完整、有条理。"
        )
        lang_directive = (
            "界面语言为简体中文。最终回答、思考过程、工具调用说明、阶段性状态提示都必须使用简体中文。"
            "除非必须保留用户原文、代码、命令、路径、报错、API 名称或专有名词，否则不要输出英文思考内容。"
            if self.ui_lang == "zh"
            else
            "The interface language is English. Keep surfaced answers, thinking text, tool commentary, and status messages in English."
        )
        self.system_prompt = (
            f"{base_system_prompt.rstrip()}\n\n{lang_directive}"
            if base_system_prompt.strip()
            else lang_directive
        )

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._queue: Optional[asyncio.Queue[bytes]] = None
        self._sentinel = object()
        self._session_key = f"bitidea-desktop:{uuid.uuid4().hex[:16]}"
        self._finished = threading.Event()

    @staticmethod
    def _content_has_image_parts(content: Any) -> bool:
        if not isinstance(content, list):
            return False
        for part in content:
            if isinstance(part, dict) and part.get("type") in {"image_url", "input_image"}:
                return True
        return False

    @staticmethod
    def _count_image_parts(content: Any) -> int:
        if not isinstance(content, list):
            return 0
        count = 0
        for part in content:
            if isinstance(part, dict) and part.get("type") in {"image_url", "input_image"}:
                count += 1
        return count

    @staticmethod
    def _collapse_content_to_text(content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if not isinstance(content, list):
            return str(content or "").strip()

        text_parts: List[str] = []
        for part in content:
            if isinstance(part, str):
                text = part.strip()
            elif isinstance(part, dict) and part.get("type") in {"text", "input_text"}:
                text = str(part.get("text", "") or "").strip()
            else:
                text = ""
            if text:
                text_parts.append(text)
        return "\n".join(text_parts).strip()

    @staticmethod
    def _materialize_data_url_for_vision(image_url: str) -> tuple[str, Optional[Path]]:
        header, _, data = str(image_url or "").partition(",")
        mime = "image/jpeg"
        if header.startswith("data:"):
            mime_part = header[len("data:"):].split(";", 1)[0].strip()
            if mime_part.startswith("image/"):
                mime = mime_part
        suffix = {
            "image/png": ".png",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
        }.get(mime, ".jpg")
        tmp = tempfile.NamedTemporaryFile(
            prefix="bitidea_desktop_image_",
            suffix=suffix,
            delete=False,
        )
        with tmp:
            tmp.write(base64.b64decode(data))
        path = Path(tmp.name)
        return str(path), path

    @staticmethod
    def _vision_home_candidates() -> List[str]:
        candidates: List[str] = []
        seen: set[str] = set()
        for raw in (os.environ.get("BITIDEA_HOME"), os.path.expanduser("~/.bitidea")):
            if not raw:
                continue
            home = str(Path(raw).expanduser())
            if home in seen:
                continue
            seen.add(home)
            home_path = Path(home)
            if not home_path.exists():
                continue
            if (home_path / "config.yaml").exists() or (home_path / "auth.json").exists():
                candidates.append(home)
        return candidates

    def _run_vision_analysis_subprocess(
        self,
        *,
        image_source: str,
        bitidea_home: str,
        prompt: str,
    ) -> Dict[str, Any]:
        script = (
            "import asyncio, sys\n"
            "from tools.vision_tools import vision_analyze_tool\n"
            "async def _main():\n"
            "    result = await vision_analyze_tool(sys.argv[1], sys.argv[2])\n"
            "    print(result)\n"
            "asyncio.run(_main())\n"
        )
        env = dict(os.environ)
        env["BITIDEA_HOME"] = bitidea_home
        completed = subprocess.run(
            [sys.executable, "-c", script, image_source, prompt],
            capture_output=True,
            text=True,
            timeout=self.IMAGE_ANALYSIS_TIMEOUT_SECONDS,
            env=env,
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        if completed.returncode != 0:
            detail = stderr or stdout or f"vision helper exited with status {completed.returncode}"
            raise RuntimeError(detail[:2000])
        if not stdout:
            raise RuntimeError(stderr or "vision helper returned no output")

        start = stdout.find("{")
        end = stdout.rfind("}")
        payload = stdout[start:end + 1] if start != -1 and end != -1 and end > start else stdout
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError as exc:
            snippet = payload[:1000] if payload else stdout[:1000]
            raise RuntimeError(f"vision helper returned invalid JSON: {exc}: {snippet}") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError("vision helper returned a non-object payload")
        return parsed

    def _describe_image_with_vision(
        self,
        image_source: str,
        *,
        cache_key_source: Optional[str] = None,
    ) -> tuple[str, str]:
        cache_source = cache_key_source if cache_key_source is not None else image_source
        cache_key = hashlib.sha256(str(cache_source or "").encode("utf-8")).hexdigest()
        with _VISION_CACHE_LOCK:
            cached = _VISION_ANALYSIS_CACHE.get(cache_key)
        if cached:
            return cached, ""

        prompt = (
            "Describe everything visible in this image in thorough detail. "
            "Include any text, code, UI, data, objects, people, layout, colors, "
            "and any other notable visual information."
        )
        errors: List[str] = []
        for bitidea_home in self._vision_home_candidates():
            for attempt in range(2):
                try:
                    result = self._run_vision_analysis_subprocess(
                        image_source=image_source,
                        bitidea_home=bitidea_home,
                        prompt=prompt,
                    )
                except Exception as exc:  # noqa: BLE001
                    error_text = str(exc).strip() or "vision analysis failed"
                    if attempt == 0 and "connection error" in error_text.lower():
                        continue
                    errors.append(f"{Path(bitidea_home).name}: {error_text}")
                    break

                analysis = str(result.get("analysis") or "").strip()
                if result.get("success") and analysis:
                    with _VISION_CACHE_LOCK:
                        _VISION_ANALYSIS_CACHE[cache_key] = analysis
                    return analysis, ""

                error_text = (
                    analysis
                    or str(result.get("error") or "").strip()
                    or "vision analysis failed"
                )
                if attempt == 0 and "connection error" in error_text.lower():
                    continue
                errors.append(f"{Path(bitidea_home).name}: {error_text}")
                break

        if not errors:
            errors.append("no configured vision backend available")
        return "", "; ".join(errors)

    def _preprocess_multimodal_content(
        self,
        content: Any,
        *,
        role: str,
        image_offset: int = 0,
        total_images: int = 0,
        show_progress: bool = True,
    ) -> tuple[str, int]:
        if not self._content_has_image_parts(content):
            return self._collapse_content_to_text(content), 0

        role_label = {
            "assistant": "助手",
            "tool": "工具结果",
        }.get(role, "用户")
        text_parts: List[str] = []
        image_notes: List[str] = []
        processed_images = 0
        cleanup_paths: List[Path] = []

        try:
            for part in content:
                if isinstance(part, str):
                    text = part.strip()
                    if text:
                        text_parts.append(text)
                    continue
                if not isinstance(part, dict):
                    continue

                ptype = part.get("type")
                if ptype in {"text", "input_text"}:
                    text = str(part.get("text", "") or "").strip()
                    if text:
                        text_parts.append(text)
                    continue

                if ptype not in {"image_url", "input_image"}:
                    text = str(part.get("text", "") or "").strip()
                    if text:
                        text_parts.append(text)
                    continue

                image_data = part.get("image_url", {})
                image_source = (
                    image_data.get("url", "")
                    if isinstance(image_data, dict)
                    else str(image_data or "")
                )
                processed_images += 1
                if show_progress:
                    current_index = image_offset + processed_images
                    if total_images > 0:
                        self._push_status(f"正在识别图片 {current_index}/{total_images}...")
                    else:
                        self._push_status("正在识别图片...")

                if not image_source:
                    image_notes.append(f"[{role_label}附带了一张图片，但没有拿到可读取的图片源。]")
                    continue

                vision_source = image_source
                cleanup_path: Optional[Path] = None
                if vision_source.startswith("data:"):
                    try:
                        vision_source, cleanup_path = self._materialize_data_url_for_vision(
                            vision_source
                        )
                    except Exception as exc:  # noqa: BLE001
                        image_notes.append(
                            f"[{role_label}附带了一张图片，但图片数据解析失败：{exc}。"
                            "请继续基于文字上下文回答，不要尝试把 data URL 当网页打开。]"
                        )
                        continue
                    if cleanup_path is not None:
                        cleanup_paths.append(cleanup_path)

                analysis, error_text = self._describe_image_with_vision(
                    vision_source,
                    cache_key_source=image_source,
                )
                if analysis:
                    note = f"[{role_label}附带了一张图片，图片内容如下：\n{analysis}]"
                    if vision_source and not image_source.startswith("data:"):
                        note += (
                            f"\n[如果需要进一步查看，可使用 vision_analyze，image_url: {vision_source}]"
                        )
                    image_notes.append(note)
                else:
                    image_notes.append(
                        f"[{role_label}附带了一张图片，但图片识别失败：{error_text or '未知错误'}。"
                        "请继续基于文字上下文回答，不要尝试把 data URL 当网页打开。]"
                    )
        finally:
            for cleanup_path in cleanup_paths:
                try:
                    cleanup_path.unlink()
                except OSError:
                    pass

        prefix = "\n\n".join(note for note in image_notes if note).strip()
        suffix = "\n".join(text for text in text_parts if text).strip()
        if prefix and suffix:
            return f"{prefix}\n\n{suffix}", processed_images
        if prefix:
            return prefix, processed_images
        if suffix:
            return suffix, processed_images
        return f"[{role_label}附带了一张图片。]", processed_images

    def _preprocess_messages_for_image_fallback(
        self,
        messages: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if self.provider != "custom":
            return messages

        total_images = sum(
            self._count_image_parts(msg.get("content"))
            for msg in messages
            if isinstance(msg, dict)
        )
        if total_images == 0:
            return messages

        processed_images = 0
        transformed: List[Dict[str, Any]] = []
        try:
            last_index = len(messages) - 1
            for index, msg in enumerate(messages):
                if not isinstance(msg, dict):
                    transformed.append(msg)
                    continue
                content = msg.get("content")
                if not self._content_has_image_parts(content):
                    transformed.append(msg)
                    continue
                rewritten, consumed = self._preprocess_multimodal_content(
                    content,
                    role=str(msg.get("role", "user") or "user"),
                    image_offset=processed_images,
                    total_images=total_images,
                    show_progress=index == last_index,
                )
                processed_images += consumed
                transformed.append({**msg, "content": rewritten})
            return transformed
        finally:
            self._push_status("")

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

    def _push_status(self, text: Any) -> None:
        """Push a frontend-friendly status frame."""
        self._push("status", {"text": sanitize_status_text(text)})

    def _make_callbacks(self) -> Dict[str, Any]:
        """Build the callback bundle AIAgent expects.

        Each callback runs on the agent's worker thread and forwards the
        event into the asyncio queue.
        """
        tool_ids: Dict[str, str] = {}
        reasoning_streamed = False

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
            nonlocal reasoning_streamed
            if event_type == "reasoning.available":
                text = (preview or "").strip()
                if text and not reasoning_streamed:
                    reasoning_streamed = True
                    self._push_status("")
                    self._push("thinking", {"text": text})
                return
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
            # Peek at the remember cache to decide whether this invocation
            # will be auto-approved. The actual resolve happens later in
            # notify() when the tool worker hits the guard — this read is
            # idempotent on the cache (no side effects on a hit) so it's
            # safe to call here for UI purposes.
            auto_allowed = False
            allowed_until_ms: Optional[int] = None
            hit, expires_at_mono = APPROVALS.check_remember(name, args)
            if hit:
                auto_allowed = True
                if expires_at_mono is not None:
                    delta = expires_at_mono - time.monotonic()
                    allowed_until_ms = int((time.time() + max(0.0, delta)) * 1000)
                else:
                    allowed_until_ms = int(time.time() * 1000)
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
            # ``thinking_callback`` in bitidea-agent is a kawaii placeholder
            # spinner ("formulating...", "pondering..."), not the model's real
            # reasoning text. Surface it as ephemeral status instead of mixing
            # it into the THINKING panel.
            if reasoning_streamed and not text:
                return
            self._push_status(text)

        def reasoning(text: str) -> None:
            nonlocal reasoning_streamed
            if not text:
                return
            reasoning_streamed = True
            self._push_status("")
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
                self._push_status(text)

        return dict(
            stream_delta_callback=stream_delta,
            tool_progress_callback=tool_progress,
            thinking_callback=thinking,
            reasoning_callback=reasoning,
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
            # approval entry. The tool_start SSE event emits the auto_allowed
            # badge by peeking at the same cache (see tool_progress below).
            hit, _ = APPROVALS.check_remember(tool_name, args)
            if hit:
                from tools import approval as _approval

                _approval.resolve_gateway_approval(self._session_key, "once")
                self._push_status(f"(auto-allowed cached approval: {tool_name})")
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
        prev_cwd: Optional[str] = None
        try:
            # If a project path was supplied, switch the worker thread's cwd so
            # file-based tools operate relative to the project directory.
            if self.project_path and os.path.isdir(self.project_path):
                prev_cwd = os.getcwd()
                os.chdir(self.project_path)

            # Route bitidea-agent state away from ~/.bitidea/ to keep Desktop
            # isolated from the standalone CLI.
            bitidea_home = _agent_state_dir()
            os.environ["BITIDEA_HOME"] = bitidea_home
            _sync_agent_skills_once(bitidea_home)
            prepared_messages = self._preprocess_messages_for_image_fallback(self.messages)
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
                agent_provider = self.provider
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
                    platform="desktop",
                    gateway_session_key=self._session_key,
                    **cb,
                )
                # Drain incoming history — last message is the new user prompt,
                # everything before is conversation context.
                if not prepared_messages:
                    raise ValueError("empty messages list")
                *history, last = prepared_messages
                if last["role"] != "user":
                    raise ValueError("last message must be role=user")
                # Pass the last user message content directly to the agent.
                # For multimodal messages (list of content parts with images),
                # preserve the full structure so the LLM can see images.
                user_content = last["content"]
                if isinstance(user_content, list):
                    persist_text = " ".join(
                        part.get("text", "") for part in user_content
                        if isinstance(part, dict) and part.get("type") == "text"
                    )
                else:
                    persist_text = None
                history_dicts: List[Dict[str, Any]] = [
                    {"role": m["role"], "content": m["content"]} for m in history
                ]
                result = agent.run_conversation(
                    user_message=user_content,
                    system_message=self.system_prompt,
                    conversation_history=history_dicts or None,
                    persist_user_message=persist_text,
                )
                final_response = str((result or {}).get("final_response") or "").strip()
                if final_response and final_response != "(empty)":
                    self._push("final_response", {"text": final_response})
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
            # Restore original working directory if we changed it.
            if prev_cwd is not None:
                try:
                    os.chdir(prev_cwd)
                except OSError:
                    pass
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
