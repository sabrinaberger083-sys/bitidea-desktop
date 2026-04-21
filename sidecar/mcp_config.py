"""MCP server configuration management."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

MCP_CONFIG_PATH = Path.home() / ".bitidea-desktop" / "mcp_servers.json"


@dataclass
class McpServerConfig:
    """One MCP server entry."""

    id: str
    name: str
    command: str  # e.g. "npx" or "python"
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    enabled: bool = True

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "command": self.command,
            "args": self.args,
            "env": self.env,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "McpServerConfig":
        return cls(
            id=d["id"],
            name=d["name"],
            command=d["command"],
            args=d.get("args", []),
            env=d.get("env", {}),
            enabled=d.get("enabled", True),
        )


def load_mcp_configs() -> List[McpServerConfig]:
    if not MCP_CONFIG_PATH.exists():
        return []
    try:
        data = json.loads(MCP_CONFIG_PATH.read_text("utf-8"))
        return [McpServerConfig.from_dict(s) for s in data.get("servers", [])]
    except (json.JSONDecodeError, KeyError, TypeError):
        return []


def save_mcp_configs(configs: List[McpServerConfig]) -> None:
    MCP_CONFIG_PATH.parent.mkdir(mode=0o700, exist_ok=True)
    data = {"servers": [c.to_dict() for c in configs]}
    MCP_CONFIG_PATH.write_text(json.dumps(data, indent=2), "utf-8")
