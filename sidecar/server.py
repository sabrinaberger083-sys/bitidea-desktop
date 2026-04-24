"""Bitidea Desktop sidecar HTTP+SSE API.

Security model
--------------
This server is a *local-only* subprocess spawned by the Tauri desktop app.

1. It binds to 127.0.0.1 exclusively (see ``__main__.py``). It is never
   reachable from the network or other hosts.
2. On startup a random token is generated and printed to stdout as
   ``SIDECAR_TOKEN=<hex>``. The parent Tauri process reads this line and
   echoes the token back in the ``X-Bitidea-Token`` header on every
   request. All endpoints except ``/health`` reject requests missing or
   mismatching this header. This defends against drive-by attacks by
   other local processes that might otherwise speak to 127.0.0.1.
3. The user's API key is written to ``~/.bitidea-desktop/config.json``
   with mode ``0600`` (user-only readable) inside a ``0700`` directory.
4. Upstream LLM calls are made with ``httpx.AsyncClient`` and any errors
   are surfaced to the UI as SSE ``error`` events rather than raw
   tracebacks.

v0.2 — agent integration
------------------------
``POST /chat`` is now backed by bitidea-agent (``AIAgent.run_conversation``)
running on a worker thread with its callbacks piped through an
``asyncio.Queue`` into the SSE stream. See ``agent_bridge.py``. All tools
are enabled. Dangerous commands flow through ``POST /approval``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Literal, Optional, Union

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .agent_bridge import APPROVALS, AgentRunner
from .knowledge_base import add_document, remove_document, list_documents, search_chunks
from .mcp_client import McpManager
from .mcp_config import McpServerConfig, load_mcp_configs, save_mcp_configs
from .routines import Routine, load_routines, save_routines, get_run_history
from .scheduler import RoutineScheduler

logger = logging.getLogger("sidecar.server")

VERSION = "0.1.0"
Provider = Literal[
    "openai", "openrouter", "anthropic", "gemini", "zai", "kimi",
    "minimax", "xiaomi", "huggingface", "arcee", "ollama-cloud",
    "opencode-zen", "opencode-go", "custom",
]

CONFIG_DIR = Path.home() / ".bitidea-desktop"
CONFIG_PATH = CONFIG_DIR / "config.json"

# Generated once per process and exported via ``get_token()`` so
# ``__main__.py`` can print it for the Tauri parent to read.
_SIDECAR_TOKEN = secrets.token_hex(32)


def get_token() -> str:
    """Return the per-process auth token."""
    return _SIDECAR_TOKEN


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ConfigIn(BaseModel):
    provider: Provider
    model: str
    # api_key is optional: Settings panel updates provider/model/base_url
    # without rotating the key. The server keeps the existing key when omitted.
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ConfigOut(BaseModel):
    provider: Optional[Provider] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    has_api_key: bool = False


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Union[str, list[Any]]


class ChatIn(BaseModel):
    messages: list[ChatMessage]
    project_path: Optional[str] = None
    system_prompt: Optional[str] = None


class ApprovalIn(BaseModel):
    request_id: str
    allow: bool
    remember: bool = False


class McpServerIn(BaseModel):
    id: str
    name: str
    command: str
    args: list[str] = []
    env: dict[str, str] = {}
    enabled: bool = True


class TestResult(BaseModel):
    ok: bool
    error: Optional[str] = None


class RoutineIn(BaseModel):
    id: Optional[str] = None
    name: str
    prompt: str
    cron: str = "09:00"
    project_id: Optional[str] = None
    project_path: Optional[str] = None
    enabled: bool = True


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------


def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_config(data: dict) -> None:
    CONFIG_DIR.mkdir(mode=0o700, exist_ok=True)
    try:
        os.chmod(CONFIG_DIR, 0o700)
    except OSError:
        pass
    # Atomic write: open with O_CREAT|O_EXCL|0o600 so the file is born with
    # the right permissions (no window where mode is 0644), fsync before
    # replacing the live file so a crash doesn't leave it half-written.
    tmp_path = CONFIG_PATH.with_suffix(".json.tmp")
    try:
        os.unlink(tmp_path)
    except FileNotFoundError:
        pass
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(tmp_path, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(data, indent=2))
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    os.replace(tmp_path, CONFIG_PATH)


_PROVIDER_BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com",
    "openrouter": "https://openrouter.ai/api",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "zai": "https://api.z.ai/api/paas/v4",
    "kimi": "https://api.kimi.com/coding/v1",
    "minimax": "https://api.minimax.io/v1",
    "xiaomi": "https://api.xiaomimimo.com/v1",
    "huggingface": "https://router.huggingface.co/v1",
    "arcee": "https://conductor.arcee.ai/v1",
    "ollama-cloud": "https://ollama.com/v1",
    "opencode-zen": "https://opencode.ai/zen/v1",
    "opencode-go": "https://opencode.ai/zen/go/v1",
}


def _default_base_url(provider: Provider, base_url: Optional[str]) -> str:
    if base_url:
        return base_url.rstrip("/")
    if provider == "custom":
        raise HTTPException(400, "custom provider requires base_url")
    url = _PROVIDER_BASE_URLS.get(provider)
    if not url:
        raise HTTPException(400, f"unknown provider {provider!r}")
    return url


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------


async def require_token(
    x_bitidea_token: Optional[str] = Header(default=None, alias="X-Bitidea-Token"),
) -> None:
    if not x_bitidea_token or not secrets.compare_digest(
        x_bitidea_token, _SIDECAR_TOKEN
    ):
        raise HTTPException(status_code=401, detail="invalid or missing token")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Bitidea Sidecar", version=VERSION)

# Global MCP manager
mcp_manager = McpManager()

# Global routine scheduler
scheduler = RoutineScheduler()

# Webview and Vite dev server run on different origins than the sidecar
# (tauri://localhost / http://localhost:1420 vs http://127.0.0.1:<port>).
# Token auth gates access; CORS just unblocks the browser fetch.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "version": VERSION}


@app.get("/config", dependencies=[Depends(require_token)], response_model=ConfigOut)
async def get_config() -> ConfigOut:
    data = _load_config()
    return ConfigOut(
        provider=data.get("provider"),
        model=data.get("model"),
        base_url=data.get("base_url"),
        has_api_key=bool(data.get("api_key")),
    )


@app.post("/config", dependencies=[Depends(require_token)])
async def set_config(body: ConfigIn) -> dict:
    existing = _load_config()
    api_key = body.api_key or existing.get("api_key")
    if not api_key:
        raise HTTPException(400, "api_key required on first save")
    payload = {
        "provider": body.provider,
        "model": body.model,
        "api_key": api_key,
        "base_url": body.base_url,
    }
    _save_config(payload)
    return {"ok": True}


@app.post("/test-connection", dependencies=[Depends(require_token)], response_model=TestResult)
async def test_connection(body: Optional[ConfigIn] = None) -> TestResult:
    cfg = body.model_dump() if body else _load_config()
    if not cfg.get("api_key"):
        return TestResult(ok=False, error="no api_key configured")
    provider: Provider = cfg["provider"]
    base_url = _default_base_url(provider, cfg.get("base_url"))
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if provider == "anthropic":
                # Anthropic has no /models GET; do a tiny messages probe.
                r = await client.post(
                    f"{base_url}/v1/messages",
                    headers={
                        "x-api-key": cfg["api_key"],
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": cfg.get("model") or "claude-3-5-haiku-latest",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
            else:
                # Providers whose base_url already includes a versioned path
                # (e.g. /v1, /v1beta/openai) use /models directly.
                if re.search(r"/v\d", base_url):
                    models_url = f"{base_url}/models"
                else:
                    models_url = f"{base_url}/v1/models"
                r = await client.get(
                    models_url,
                    headers={"Authorization": f"Bearer {cfg['api_key']}"},
                )
            if r.status_code >= 400:
                return TestResult(ok=False, error=f"HTTP {r.status_code}: {r.text[:200]}")
            return TestResult(ok=True)
    except httpx.HTTPError as exc:
        return TestResult(ok=False, error=str(exc))


# ---------------------------------------------------------------------------
# Chat streaming (agent-backed)
# ---------------------------------------------------------------------------
#
# SSE protocol (all events JSON-encoded in the ``data:`` field):
#   token            { text: string }                   — LLM token delta
#   thinking         { text: string }                   — reasoning trace chunk
#   tool_start       { id, name, args, preview }        — tool invocation begins
#   tool_output      { id, chunk: string }              — streamed tool stdout
#   tool_result      { id, ok, summary, truncated }     — tool finished
#   approval_request { request_id, tool_name, args, preview } — user prompt
#   step             { n: int, total: int }             — agent step indicator
#   status           { text: string }                   — ephemeral status line
#   error            { message: string }                — terminal error
#   done             {}                                 — sentinel, stream ends


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


@app.post("/chat", dependencies=[Depends(require_token)])
async def chat(body: ChatIn, request: Request) -> StreamingResponse:
    cfg = _load_config()
    if not cfg.get("api_key") or not cfg.get("provider") or not cfg.get("model"):
        return JSONResponse(
            {"error": "sidecar not configured; POST /config first"}, status_code=400
        )
    provider: Provider = cfg["provider"]
    # Validate base_url early so we emit a clean 400 rather than a 500.
    try:
        base_url = _default_base_url(provider, cfg.get("base_url"))
    except HTTPException:
        raise
    messages = [m.model_dump() for m in body.messages]

    # RAG: inject relevant knowledge-base chunks into the last user message
    if body.project_path:
        import hashlib as _hl

        project_id = _hl.sha256(body.project_path.encode()).hexdigest()[:16]
        last_user_content = None
        for m in reversed(body.messages):
            if m.role == "user":
                last_user_content = m.content
                break
        # Extract plain text for KB search (content may be str or list)
        if isinstance(last_user_content, list):
            last_user_msg = " ".join(
                part.get("text", "") for part in last_user_content
                if isinstance(part, dict) and part.get("type") == "text"
            )
        else:
            last_user_msg = last_user_content or ""
        if last_user_msg:
            try:
                chunks = search_chunks(project_id, last_user_msg, limit=3)
            except Exception:
                chunks = []
            if chunks:
                context_parts = []
                for chunk in chunks:
                    context_parts.append(f"[From: {chunk.doc_name}]\n{chunk.content}")
                context_block = "\n\n---\n\n".join(context_parts)
                rag_prefix = (
                    "<knowledge_base>\n"
                    "The following excerpts from project documents may be relevant:\n\n"
                    f"{context_block}\n"
                    "</knowledge_base>\n\n"
                )
                # Prepend to the last user message
                if isinstance(messages[-1]["content"], list):
                    messages[-1]["content"].insert(0, {"type": "text", "text": rag_prefix})
                else:
                    messages[-1]["content"] = rag_prefix + messages[-1]["content"]

    runner = AgentRunner(
        provider=provider,
        model=cfg["model"],
        api_key=cfg["api_key"],
        base_url=base_url,
        messages=messages,
        project_path=body.project_path,
        system_prompt=body.system_prompt,
    )

    async def gen() -> AsyncIterator[bytes]:
        try:
            async for chunk in runner.stream():
                if await request.is_disconnected():
                    APPROVALS.cancel_all()
                    return
                yield chunk
        except Exception as exc:  # noqa: BLE001 — surface anything to UI
            import traceback

            traceback.print_exc()
            detail = str(exc) or repr(exc) or type(exc).__name__
            yield _sse("error", {"message": f"sidecar {type(exc).__name__}: {detail}"})
            yield _sse("done", {})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Approval resolution
# ---------------------------------------------------------------------------


@app.post("/approval", dependencies=[Depends(require_token)])
async def approval(body: ApprovalIn) -> dict:
    """Resolve a pending ``approval_request`` SSE event.

    * ``allow=true, remember=false`` -> allow this one tool call.
    * ``allow=true, remember=true``  -> allow + cache ``(tool_name, sha256(args))``
      for 60 seconds. Repeat identical calls skip the modal.
    * ``allow=false`` -> deny.

    Returns ``{ok: true}`` if we matched a pending request, otherwise 404.
    """
    matched = APPROVALS.resolve(body.request_id, body.allow, body.remember)
    if not matched:
        raise HTTPException(404, "no pending approval with that request_id")
    return {"ok": True}


# ---------------------------------------------------------------------------
# MCP server management
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup_mcp() -> None:
    configs = load_mcp_configs()
    for c in configs:
        if c.enabled:
            try:
                await mcp_manager.start_server(c)
            except Exception:
                logger.exception("Failed to start MCP server %s", c.name)


@app.on_event("shutdown")
async def shutdown_mcp() -> None:
    await mcp_manager.stop_all()


@app.get("/mcp/servers", dependencies=[Depends(require_token)])
async def list_mcp_servers() -> list[dict]:
    configs = load_mcp_configs()
    result = []
    for c in configs:
        d = c.to_dict()
        client = mcp_manager.get_client(c.id)
        d["running"] = client is not None
        d["tool_count"] = len(await client.list_tools()) if client else 0
        result.append(d)
    return result


@app.post("/mcp/servers", dependencies=[Depends(require_token)])
async def add_mcp_server(body: McpServerIn) -> dict:
    configs = load_mcp_configs()
    new_config = McpServerConfig(
        id=body.id,
        name=body.name,
        command=body.command,
        args=body.args,
        env=body.env,
        enabled=body.enabled,
    )
    configs = [c for c in configs if c.id != body.id]  # upsert
    configs.append(new_config)
    save_mcp_configs(configs)
    if body.enabled:
        try:
            await mcp_manager.start_server(new_config)
        except Exception as e:
            return {"ok": True, "warning": str(e)}
    return {"ok": True}


@app.delete("/mcp/servers/{server_id}", dependencies=[Depends(require_token)])
async def remove_mcp_server(server_id: str) -> dict:
    await mcp_manager.stop_server(server_id)
    configs = load_mcp_configs()
    configs = [c for c in configs if c.id != server_id]
    save_mcp_configs(configs)
    return {"ok": True}


@app.post("/mcp/servers/{server_id}/toggle", dependencies=[Depends(require_token)])
async def toggle_mcp_server(server_id: str) -> dict:
    configs = load_mcp_configs()
    for c in configs:
        if c.id == server_id:
            c.enabled = not c.enabled
            if c.enabled:
                try:
                    await mcp_manager.start_server(c)
                except Exception as e:
                    save_mcp_configs(configs)
                    return {"ok": True, "enabled": c.enabled, "error": str(e)}
            else:
                await mcp_manager.stop_server(server_id)
            save_mcp_configs(configs)
            return {"ok": True, "enabled": c.enabled}
    return {"ok": False, "error": "not found"}


@app.get("/mcp/tools", dependencies=[Depends(require_token)])
async def list_mcp_tools() -> list[dict]:
    return await mcp_manager.get_all_tools()


# ---------------------------------------------------------------------------
# Knowledge Base (per-project document chunking + FTS5 retrieval)
# ---------------------------------------------------------------------------


class KbDocIn(BaseModel):
    name: str
    path: str
    content: str


@app.get("/kb/{project_id}/documents", dependencies=[Depends(require_token)])
async def kb_list_docs(project_id: str) -> list[dict]:
    docs = list_documents(project_id)
    return [
        {
            "id": d.id,
            "name": d.name,
            "path": d.path,
            "chunk_count": d.chunk_count,
            "created_at": d.created_at,
        }
        for d in docs
    ]


@app.post("/kb/{project_id}/documents", dependencies=[Depends(require_token)])
async def kb_add_doc(project_id: str, body: KbDocIn) -> dict:
    doc = add_document(project_id, body.name, body.path, body.content)
    return {"ok": True, "id": doc.id, "chunk_count": doc.chunk_count}


@app.delete("/kb/{project_id}/documents/{doc_id}", dependencies=[Depends(require_token)])
async def kb_remove_doc(project_id: str, doc_id: str) -> dict:
    remove_document(project_id, doc_id)
    return {"ok": True}


@app.get("/kb/{project_id}/search", dependencies=[Depends(require_token)])
async def kb_search(project_id: str, q: str = "", limit: int = 5) -> list[dict]:
    if not q.strip():
        return []
    chunks = search_chunks(project_id, q, limit)
    return [
        {
            "id": c.id,
            "doc_id": c.doc_id,
            "doc_name": c.doc_name,
            "content": c.content,
            "chunk_index": c.chunk_index,
            "score": c.score,
        }
        for c in chunks
    ]


# ---------------------------------------------------------------------------
# Routines (scheduled AI tasks)
# ---------------------------------------------------------------------------


@app.get("/routines", dependencies=[Depends(require_token)])
async def list_routines() -> list[dict]:
    return [r.to_dict() for r in load_routines()]


@app.post("/routines", dependencies=[Depends(require_token)])
async def upsert_routine(body: RoutineIn) -> dict:
    routines = load_routines()
    rid = body.id or uuid.uuid4().hex[:12]
    now = int(time.time() * 1000)
    existing = next((r for r in routines if r.id == rid), None)
    if existing:
        existing.name = body.name
        existing.prompt = body.prompt
        existing.cron = body.cron
        existing.project_id = body.project_id
        existing.project_path = body.project_path
        existing.enabled = body.enabled
    else:
        routines.append(Routine(
            id=rid, name=body.name, prompt=body.prompt, cron=body.cron,
            project_id=body.project_id, project_path=body.project_path,
            enabled=body.enabled, created_at=now,
        ))
    save_routines(routines)
    return {"ok": True, "id": rid}


@app.delete("/routines/{routine_id}", dependencies=[Depends(require_token)])
async def delete_routine(routine_id: str) -> dict:
    routines = load_routines()
    routines = [r for r in routines if r.id != routine_id]
    save_routines(routines)
    return {"ok": True}


@app.post("/routines/{routine_id}/toggle", dependencies=[Depends(require_token)])
async def toggle_routine(routine_id: str) -> dict:
    routines = load_routines()
    for r in routines:
        if r.id == routine_id:
            r.enabled = not r.enabled
            save_routines(routines)
            return {"ok": True, "enabled": r.enabled}
    return {"ok": False, "error": "not found"}


@app.post("/routines/{routine_id}/run", dependencies=[Depends(require_token)])
async def run_routine_now(routine_id: str) -> dict:
    routines = load_routines()
    routine = next((r for r in routines if r.id == routine_id), None)
    if not routine:
        return JSONResponse({"error": "not found"}, status_code=404)
    result = await scheduler.run_routine_now(routine)
    return {"ok": True, "status": result.status, "output": result.output[:500]}


@app.get("/routines/{routine_id}/history", dependencies=[Depends(require_token)])
async def routine_history(routine_id: str, limit: int = 10) -> list[dict]:
    return get_run_history(routine_id, limit)


# ---------------------------------------------------------------------------
# Routine scheduler lifecycle
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup_scheduler() -> None:
    """Start the background routine scheduler with an agent-backed callback."""

    async def run_prompt(prompt: str, project_path: Optional[str] = None) -> str:
        cfg = _load_config()
        if not cfg.get("api_key"):
            return "(no API key configured)"

        provider = cfg["provider"]
        base_url = _default_base_url(provider, cfg.get("base_url"))

        runner = AgentRunner(
            provider=provider,
            model=cfg["model"],
            api_key=cfg["api_key"],
            base_url=base_url,
            messages=[{"role": "user", "content": prompt}],
            project_path=project_path,
        )

        output_parts: list[str] = []
        async for chunk in runner.stream():
            text = chunk.decode("utf-8", errors="ignore")
            if "event: token" in text:
                m = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
                if m:
                    output_parts.append(
                        m.group(1).encode().decode("unicode_escape")
                    )

        return "".join(output_parts)

    scheduler.set_run_callback(run_prompt)
    await scheduler.start()


@app.on_event("shutdown")
async def shutdown_scheduler() -> None:
    await scheduler.stop()


# ---------------------------------------------------------------------------
# Memory system
# ---------------------------------------------------------------------------

AGENT_STATE_DIR = Path.home() / ".bitidea-desktop" / "agent-state"


def _agent_config_yaml() -> Path:
    return AGENT_STATE_DIR / "config.yaml"


def _load_agent_yaml() -> dict:
    p = _agent_config_yaml()
    if not p.exists():
        return {}
    try:
        import yaml
        return yaml.safe_load(p.read_text("utf-8")) or {}
    except Exception:
        return {}


def _save_agent_yaml(data: dict) -> None:
    import yaml
    AGENT_STATE_DIR.mkdir(parents=True, exist_ok=True)
    _agent_config_yaml().write_text(yaml.dump(data, default_flow_style=False), "utf-8")


class MemoryConfigIn(BaseModel):
    enabled: bool = True
    provider: Optional[str] = "builtin"
    honcho_api_key: Optional[str] = None
    recall_mode: Optional[str] = "hybrid"


@app.get("/memory/status", dependencies=[Depends(require_token)])
async def memory_status() -> dict:
    cfg = _load_agent_yaml()
    mem = cfg.get("memory", {})
    honcho_json = AGENT_STATE_DIR / "honcho.json"
    honcho_connected = False
    if honcho_json.exists():
        try:
            hdata = json.loads(honcho_json.read_text("utf-8"))
            honcho_connected = bool(hdata.get("enabled"))
        except Exception:
            pass
    return {
        "enabled": mem.get("enabled", True),
        "provider": mem.get("provider", "builtin"),
        "recall_mode": mem.get("recall_mode", "hybrid"),
        "honcho_connected": honcho_connected,
        "has_honcho_key": bool(mem.get("honcho_api_key")),
    }


@app.post("/memory/config", dependencies=[Depends(require_token)])
async def save_memory_config(body: MemoryConfigIn) -> dict:
    cfg = _load_agent_yaml()
    mem = cfg.setdefault("memory", {})
    mem["enabled"] = body.enabled
    mem["provider"] = body.provider or "builtin"
    mem["recall_mode"] = body.recall_mode or "hybrid"
    if body.honcho_api_key:
        mem["honcho_api_key"] = body.honcho_api_key
    _save_agent_yaml(cfg)

    if body.provider == "honcho" and body.honcho_api_key:
        honcho_json = AGENT_STATE_DIR / "honcho.json"
        AGENT_STATE_DIR.mkdir(parents=True, exist_ok=True)
        honcho_json.write_text(json.dumps({
            "enabled": True,
            "api_key": body.honcho_api_key,
        }, indent=2), "utf-8")

    return {"ok": True}


@app.get("/memory/entries", dependencies=[Depends(require_token)])
async def memory_entries() -> dict:
    result: dict[str, Optional[str]] = {"memory_md": None, "user_md": None}
    for name, key in [("MEMORY.md", "memory_md"), ("USER.md", "user_md")]:
        p = AGENT_STATE_DIR / name
        if p.exists():
            try:
                result[key] = p.read_text("utf-8")
            except Exception:
                result[key] = None
    return result


# ---------------------------------------------------------------------------
# Terminal backend config
# ---------------------------------------------------------------------------


class TerminalConfigIn(BaseModel):
    backend: str = "local"
    docker_image: Optional[str] = None
    ssh_host: Optional[str] = None
    ssh_user: Optional[str] = None
    ssh_port: Optional[int] = 22
    ssh_key: Optional[str] = None
    modal_image: Optional[str] = None


@app.get("/terminal/config", dependencies=[Depends(require_token)])
async def get_terminal_config() -> dict:
    cfg = _load_agent_yaml()
    term = cfg.get("terminal", {})
    return {
        "backend": term.get("backend", "local"),
        "docker_image": term.get("docker_image"),
        "ssh_host": term.get("ssh_host"),
        "ssh_user": term.get("ssh_user"),
        "ssh_port": term.get("ssh_port", 22),
        "ssh_key": term.get("ssh_key"),
        "modal_image": term.get("modal_image"),
    }


@app.post("/terminal/config", dependencies=[Depends(require_token)])
async def save_terminal_config(body: TerminalConfigIn) -> dict:
    cfg = _load_agent_yaml()
    term = cfg.setdefault("terminal", {})
    term["backend"] = body.backend
    if body.docker_image:
        term["docker_image"] = body.docker_image
    if body.ssh_host:
        term["ssh_host"] = body.ssh_host
        term["ssh_user"] = body.ssh_user or "root"
        term["ssh_port"] = body.ssh_port or 22
        term["ssh_key"] = body.ssh_key
    if body.modal_image:
        term["modal_image"] = body.modal_image
    _save_agent_yaml(cfg)

    os.environ["TERMINAL_ENV"] = body.backend
    if body.docker_image:
        os.environ["TERMINAL_DOCKER_IMAGE"] = body.docker_image
    if body.ssh_host:
        os.environ["TERMINAL_SSH_HOST"] = body.ssh_host
        os.environ["TERMINAL_SSH_USER"] = body.ssh_user or "root"
        os.environ["TERMINAL_SSH_PORT"] = str(body.ssh_port or 22)
        if body.ssh_key:
            os.environ["TERMINAL_SSH_KEY"] = body.ssh_key

    return {"ok": True}


# ---------------------------------------------------------------------------
# Voice (STT / TTS)
# ---------------------------------------------------------------------------


class VoiceTranscribeIn(BaseModel):
    audio_base64: str
    format: str = "webm"


class VoiceSynthesizeIn(BaseModel):
    text: str
    voice: Optional[str] = None


@app.get("/voice/config", dependencies=[Depends(require_token)])
async def get_voice_config() -> dict:
    cfg = _load_agent_yaml()
    stt = cfg.get("stt", {})
    tts = cfg.get("tts", {})
    return {
        "stt_provider": stt.get("provider", "local"),
        "tts_provider": tts.get("provider", "edge-tts"),
        "stt_available": True,
        "tts_available": True,
    }


@app.post("/voice/config", dependencies=[Depends(require_token)])
async def save_voice_config(body: dict) -> dict:
    cfg = _load_agent_yaml()
    if "stt_provider" in body:
        cfg.setdefault("stt", {})["provider"] = body["stt_provider"]
    if "tts_provider" in body:
        cfg.setdefault("tts", {})["provider"] = body["tts_provider"]
    if "groq_api_key" in body:
        cfg.setdefault("stt", {})["groq_api_key"] = body["groq_api_key"]
    if "openai_api_key" in body:
        cfg.setdefault("voice", {})["openai_api_key"] = body["openai_api_key"]
    _save_agent_yaml(cfg)
    return {"ok": True}


@app.post("/voice/transcribe", dependencies=[Depends(require_token)])
async def voice_transcribe(body: VoiceTranscribeIn) -> dict:
    import base64
    import tempfile
    audio_bytes = base64.b64decode(body.audio_base64)
    with tempfile.NamedTemporaryFile(suffix=f".{body.format}", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    try:
        bitidea_home = str(AGENT_STATE_DIR)
        os.environ["BITIDEA_HOME"] = bitidea_home
        try:
            from tools.transcription_tools import transcribe_audio
            text = transcribe_audio(tmp_path)
        except ImportError:
            return {"ok": False, "error": "transcription tools not installed", "text": ""}
        return {"ok": True, "text": text}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/voice/synthesize", dependencies=[Depends(require_token)])
async def voice_synthesize(body: VoiceSynthesizeIn) -> dict:
    import base64
    try:
        from tools.tts_tool import synthesize_speech
        audio_bytes = synthesize_speech(body.text, voice=body.voice)
        return {"ok": True, "audio_base64": base64.b64encode(audio_bytes).decode()}
    except ImportError:
        return {"ok": False, "error": "TTS tools not installed", "audio_base64": ""}


# ---------------------------------------------------------------------------
# Messaging gateway
# ---------------------------------------------------------------------------

_gateway_bridge: Optional["GatewayBridge"] = None


class GatewayConfigIn(BaseModel):
    telegram_token: Optional[str] = None
    telegram_allowed_users: Optional[str] = None
    discord_token: Optional[str] = None
    slack_bot_token: Optional[str] = None
    slack_app_token: Optional[str] = None
    feishu_app_id: Optional[str] = None
    feishu_app_secret: Optional[str] = None
    feishu_verification_token: Optional[str] = None
    feishu_encrypt_key: Optional[str] = None


@app.get("/gateway/status", dependencies=[Depends(require_token)])
async def gateway_status() -> dict:
    global _gateway_bridge
    if _gateway_bridge is None:
        return {"running": False, "platforms": []}
    return _gateway_bridge.status()


@app.post("/gateway/start", dependencies=[Depends(require_token)])
async def gateway_start() -> dict:
    global _gateway_bridge
    if _gateway_bridge and _gateway_bridge.is_running():
        return {"ok": True, "message": "already running"}
    try:
        from .gateway_bridge import GatewayBridge
        cfg = _load_config()
        agent_cfg = _load_agent_yaml()
        _gateway_bridge = GatewayBridge(cfg, agent_cfg)
        _gateway_bridge.start()
        return {"ok": True}
    except ImportError:
        return {"ok": False, "error": "gateway dependencies not installed"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/gateway/stop", dependencies=[Depends(require_token)])
async def gateway_stop() -> dict:
    global _gateway_bridge
    if _gateway_bridge:
        _gateway_bridge.stop()
        _gateway_bridge = None
    return {"ok": True}


@app.get("/gateway/platforms", dependencies=[Depends(require_token)])
async def gateway_platforms() -> dict:
    cfg = _load_agent_yaml()
    gw = cfg.get("gateway", {})
    platforms = []
    if gw.get("telegram_token"):
        platforms.append("telegram")
    if gw.get("discord_token"):
        platforms.append("discord")
    if gw.get("slack_bot_token"):
        platforms.append("slack")
    if gw.get("feishu_app_id"):
        platforms.append("feishu")
    return {"platforms": platforms}


@app.post("/gateway/config", dependencies=[Depends(require_token)])
async def save_gateway_config(body: GatewayConfigIn) -> dict:
    cfg = _load_agent_yaml()
    gw = cfg.setdefault("gateway", {})
    if body.telegram_token is not None:
        gw["telegram_token"] = body.telegram_token
    if body.telegram_allowed_users is not None:
        gw["telegram_allowed_users"] = body.telegram_allowed_users
    if body.discord_token is not None:
        gw["discord_token"] = body.discord_token
    if body.slack_bot_token is not None:
        gw["slack_bot_token"] = body.slack_bot_token
    if body.slack_app_token is not None:
        gw["slack_app_token"] = body.slack_app_token
    if body.feishu_app_id is not None:
        gw["feishu_app_id"] = body.feishu_app_id
    if body.feishu_app_secret is not None:
        gw["feishu_app_secret"] = body.feishu_app_secret
    if body.feishu_verification_token is not None:
        gw["feishu_verification_token"] = body.feishu_verification_token
    if body.feishu_encrypt_key is not None:
        gw["feishu_encrypt_key"] = body.feishu_encrypt_key
    _save_agent_yaml(cfg)

    env_path = AGENT_STATE_DIR / ".env"
    env_lines: list[str] = []
    if body.telegram_token:
        env_lines.append(f"TELEGRAM_BOT_TOKEN={body.telegram_token}")
    if body.telegram_allowed_users:
        env_lines.append(f"TELEGRAM_ALLOWED_USERS={body.telegram_allowed_users}")
    if body.discord_token:
        env_lines.append(f"DISCORD_BOT_TOKEN={body.discord_token}")
    if body.slack_bot_token:
        env_lines.append(f"SLACK_BOT_TOKEN={body.slack_bot_token}")
    if body.slack_app_token:
        env_lines.append(f"SLACK_APP_TOKEN={body.slack_app_token}")
    if body.feishu_app_id:
        env_lines.append(f"FEISHU_APP_ID={body.feishu_app_id}")
    if body.feishu_app_secret:
        env_lines.append(f"FEISHU_APP_SECRET={body.feishu_app_secret}")
    if body.feishu_verification_token:
        env_lines.append(f"FEISHU_VERIFICATION_TOKEN={body.feishu_verification_token}")
    if body.feishu_encrypt_key:
        env_lines.append(f"FEISHU_ENCRYPT_KEY={body.feishu_encrypt_key}")

    if env_lines:
        existing = ""
        if env_path.exists():
            existing = env_path.read_text("utf-8")
        for line in env_lines:
            key = line.split("=", 1)[0]
            import re as _re
            existing = _re.sub(rf"^{key}=.*$", "", existing, flags=_re.MULTILINE)
        existing = existing.strip()
        if existing:
            existing += "\n"
        existing += "\n".join(env_lines) + "\n"
        AGENT_STATE_DIR.mkdir(parents=True, exist_ok=True)
        env_path.write_text(existing, "utf-8")

    return {"ok": True}
