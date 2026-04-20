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

For v0.1 we do NOT depend on the ``bitidea-agent`` package — this
sidecar is self-contained and calls the provider API directly. The full
agent loop will be wired in v0.2.
"""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import AsyncIterator, Literal, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

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
    content: str


class ChatIn(BaseModel):
    messages: list[ChatMessage]


class TestResult(BaseModel):
    ok: bool
    error: Optional[str] = None


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
# Chat streaming
# ---------------------------------------------------------------------------


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


async def _stream_openai_like(
    base_url: str, api_key: str, model: str, messages: list[dict]
) -> AsyncIterator[bytes]:
    url = f"{base_url}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    body = {"model": model, "messages": messages, "stream": True}
    # connect fast-fail at 15s; no overall read timeout so long generations survive.
    timeout = httpx.Timeout(connect=15.0, read=None, write=30.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=body) as r:
            if r.status_code >= 400:
                err_text = (await r.aread()).decode("utf-8", "replace")[:500]
                yield _sse("error", {"message": f"HTTP {r.status_code}: {err_text}"})
                return
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                text = delta.get("content")
                if text:
                    yield _sse("token", {"text": text})
    yield _sse("done", {})


async def _stream_anthropic(
    base_url: str, api_key: str, model: str, messages: list[dict]
) -> AsyncIterator[bytes]:
    url = f"{base_url}/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "accept": "text/event-stream",
    }
    body: dict = {
        "model": model,
        "max_tokens": 4096,
        "stream": True,
        "messages": messages,
    }
    timeout = httpx.Timeout(connect=15.0, read=None, write=30.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=body) as r:
            if r.status_code >= 400:
                err_text = (await r.aread()).decode("utf-8", "replace")[:500]
                yield _sse("error", {"message": f"HTTP {r.status_code}: {err_text}"})
                return
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                etype = obj.get("type")
                if etype == "content_block_delta":
                    delta = obj.get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield _sse("token", {"text": delta["text"]})
                elif etype == "message_stop":
                    break
    yield _sse("done", {})


@app.post("/chat", dependencies=[Depends(require_token)])
async def chat(body: ChatIn, request: Request) -> StreamingResponse:
    cfg = _load_config()
    if not cfg.get("api_key") or not cfg.get("provider") or not cfg.get("model"):
        return JSONResponse(
            {"error": "sidecar not configured; POST /config first"}, status_code=400
        )
    provider: Provider = cfg["provider"]
    base_url = _default_base_url(provider, cfg.get("base_url"))
    messages = [m.model_dump() for m in body.messages]

    async def gen() -> AsyncIterator[bytes]:
        try:
            if provider == "anthropic":
                agen = _stream_anthropic(base_url, cfg["api_key"], cfg["model"], messages)
            else:
                agen = _stream_openai_like(
                    base_url, cfg["api_key"], cfg["model"], messages
                )
            async for chunk in agen:
                if await request.is_disconnected():
                    return
                yield chunk
        except httpx.HTTPError as exc:
            import traceback
            traceback.print_exc()
            detail = str(exc) or repr(exc) or type(exc).__name__
            yield _sse("error", {"message": f"upstream {type(exc).__name__}: {detail}"})
        except Exception as exc:  # noqa: BLE001 — surface anything to UI
            import traceback
            traceback.print_exc()
            detail = str(exc) or repr(exc) or type(exc).__name__
            yield _sse("error", {"message": f"sidecar {type(exc).__name__}: {detail}"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
