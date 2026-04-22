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
Provider = Literal["openai", "openrouter", "anthropic", "custom"]

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


def _default_base_url(provider: Provider, base_url: Optional[str]) -> str:
    if provider == "openai":
        return "https://api.openai.com"
    if provider == "openrouter":
        return "https://openrouter.ai/api"
    if provider == "anthropic":
        return "https://api.anthropic.com"
    if provider == "custom":
        if not base_url:
            raise HTTPException(400, "custom provider requires base_url")
        return base_url.rstrip("/")
    raise HTTPException(400, f"unknown provider {provider!r}")


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
                r = await client.get(
                    f"{base_url}/v1/models",
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
