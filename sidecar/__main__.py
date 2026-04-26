"""Entry point: ``python -m sidecar``.

Boot sequence printed to stdout (parsed by the Tauri parent process):

    SIDECAR_PORT=<port>
    SIDECAR_TOKEN=<hex>
    SIDECAR_READY

Binds to 127.0.0.1 only — never the public interface.
"""

from __future__ import annotations

import asyncio
import signal
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

def _project_root() -> Path:
    """Return repo root in dev and the extracted app root when frozen."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent.parent


_ENGINE_DIR = str(_project_root() / "engine")
if _ENGINE_DIR not in sys.path:
    sys.path.insert(0, _ENGINE_DIR)

import uvicorn

try:
    from .server import app, get_token
except ImportError:
    # PyInstaller executes this file as a top-level script, so package-relative
    # imports are unavailable there. Fall back to an absolute package import.
    from sidecar.server import app, get_token

HOST = "127.0.0.1"


def _pick_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def _wait_ready(port: int, token: str, timeout: float = 10.0) -> None:
    """Poll /health until the server responds, then print SIDECAR_READY."""
    deadline = time.monotonic() + timeout
    url = f"http://{HOST}:{port}/health"
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(url, headers={"X-Bitidea-Token": token})
            with urllib.request.urlopen(req, timeout=1.0) as r:
                if r.status == 200:
                    print("SIDECAR_READY", flush=True)
                    return
        except Exception:
            time.sleep(0.1)
    # If we fall through, still print so the parent doesn't hang forever;
    # a follow-up /health call will fail visibly.
    print("SIDECAR_READY", flush=True)


def main() -> int:
    port = _pick_port()
    token = get_token()

    # First line(s) of stdout — Tauri parses these.
    print(f"SIDECAR_PORT={port}", flush=True)
    print(f"SIDECAR_TOKEN={token}", flush=True)

    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        log_level="warning",
        access_log=False,
        lifespan="on",
    )
    server = uvicorn.Server(config)

    # Background thread emits SIDECAR_READY once /health is up.
    threading.Thread(
        target=_wait_ready, args=(port, token), daemon=True
    ).start()

    # Graceful SIGTERM / SIGINT handling.
    loop: Optional[asyncio.AbstractEventLoop] = None

    def _shutdown(signum: int, _frame) -> None:  # noqa: ANN001
        server.should_exit = True

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _shutdown)
        except (ValueError, OSError):
            # Non-main thread or unsupported platform — uvicorn installs
            # its own handlers in that case.
            pass

    try:
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        del loop
    return 0


if __name__ == "__main__":
    sys.exit(main())
