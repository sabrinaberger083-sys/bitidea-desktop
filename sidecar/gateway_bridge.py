"""Bridge for running bitidea-agent's messaging gateway inside the sidecar.

The gateway (Telegram/Discord/Slack) runs in a dedicated thread with its
own asyncio event loop, sharing the sidecar process.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("sidecar.gateway_bridge")

AGENT_STATE_DIR = Path.home() / ".bitidea-desktop" / "agent-state"


class GatewayBridge:
    def __init__(self, llm_config: dict, agent_config: dict) -> None:
        self._llm_config = llm_config
        self._agent_config = agent_config
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._running = False

    def _setup_env(self) -> None:
        os.environ["BITIDEA_HOME"] = str(AGENT_STATE_DIR)

        gw = self._agent_config.get("gateway", {})
        env_map = {
            "TELEGRAM_BOT_TOKEN": gw.get("telegram_token"),
            "TELEGRAM_ALLOWED_USERS": gw.get("telegram_allowed_users"),
            "DISCORD_BOT_TOKEN": gw.get("discord_token"),
            "SLACK_BOT_TOKEN": gw.get("slack_bot_token"),
            "SLACK_APP_TOKEN": gw.get("slack_app_token"),
            "FEISHU_APP_ID": gw.get("feishu_app_id"),
            "FEISHU_APP_SECRET": gw.get("feishu_app_secret"),
            "FEISHU_VERIFICATION_TOKEN": gw.get("feishu_verification_token"),
            "FEISHU_ENCRYPT_KEY": gw.get("feishu_encrypt_key"),
        }
        for k, v in env_map.items():
            if v:
                os.environ[k] = str(v)

        if self._llm_config.get("api_key"):
            provider = self._llm_config.get("provider", "openrouter")
            key_env_map: Dict[str, str] = {
                "openrouter": "OPENROUTER_API_KEY",
                "openai": "OPENAI_API_KEY",
                "gemini": "GOOGLE_API_KEY",
                "zai": "GLM_API_KEY",
                "kimi": "KIMI_API_KEY",
                "minimax": "MINIMAX_API_KEY",
                "xiaomi": "XIAOMI_API_KEY",
                "huggingface": "HF_TOKEN",
                "arcee": "ARCEEAI_API_KEY",
            }
            env_key = key_env_map.get(provider, "OPENROUTER_API_KEY")
            os.environ[env_key] = self._llm_config["api_key"]

    def _run_loop(self) -> None:
        self._setup_env()
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            from gateway.run import GatewayRunner
            runner = GatewayRunner()
            self._running = True
            self._loop.run_until_complete(runner.run())
        except Exception:
            logger.exception("gateway thread crashed")
        finally:
            self._running = False
            try:
                self._loop.close()
            except Exception:
                pass

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="gateway")
        self._thread.start()

    def stop(self) -> None:
        if self._loop and self._running:
            self._loop.call_soon_threadsafe(self._loop.stop)
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def is_running(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    def status(self) -> dict:
        gw = self._agent_config.get("gateway", {})
        platforms = []
        if gw.get("telegram_token"):
            platforms.append("telegram")
        if gw.get("discord_token"):
            platforms.append("discord")
        if gw.get("slack_bot_token"):
            platforms.append("slack")
        if gw.get("feishu_app_id"):
            platforms.append("feishu")
        return {
            "running": self.is_running(),
            "platforms": platforms,
        }
