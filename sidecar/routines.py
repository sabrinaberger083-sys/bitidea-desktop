"""Scheduled routines (cron-style AI agent tasks)."""
from __future__ import annotations

import json
import logging
import uuid
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("sidecar.routines")

ROUTINES_PATH = Path.home() / ".bitidea-desktop" / "routines.json"
HISTORY_DIR = Path.home() / ".bitidea-desktop" / "routine_history"


@dataclass
class Routine:
    id: str
    name: str
    prompt: str                    # The AI prompt to execute
    cron: str                      # Cron expression (simplified: "HH:MM" for daily, or "*/N" for every N minutes)
    project_id: Optional[str] = None  # Optional project association
    project_path: Optional[str] = None
    enabled: bool = True
    created_at: int = 0
    last_run_at: Optional[int] = None
    last_status: Optional[str] = None  # "success" | "error" | "running"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "cron": self.cron,
            "project_id": self.project_id,
            "project_path": self.project_path,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "last_run_at": self.last_run_at,
            "last_status": self.last_status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Routine":
        return cls(
            id=d["id"],
            name=d["name"],
            prompt=d["prompt"],
            cron=d.get("cron", "09:00"),
            project_id=d.get("project_id"),
            project_path=d.get("project_path"),
            enabled=d.get("enabled", True),
            created_at=d.get("created_at", 0),
            last_run_at=d.get("last_run_at"),
            last_status=d.get("last_status"),
        )


@dataclass
class RunResult:
    routine_id: str
    started_at: int
    finished_at: int
    status: str  # "success" | "error"
    output: str  # The AI's response text
    error: Optional[str] = None


def load_routines() -> List[Routine]:
    if not ROUTINES_PATH.exists():
        return []
    try:
        data = json.loads(ROUTINES_PATH.read_text("utf-8"))
        return [Routine.from_dict(r) for r in data.get("routines", [])]
    except (json.JSONDecodeError, KeyError):
        return []


def save_routines(routines: List[Routine]) -> None:
    ROUTINES_PATH.parent.mkdir(mode=0o700, exist_ok=True)
    data = {"routines": [r.to_dict() for r in routines]}
    ROUTINES_PATH.write_text(json.dumps(data, indent=2), "utf-8")


def save_run_result(result: RunResult) -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    path = HISTORY_DIR / f"{result.routine_id}_{result.started_at}.json"
    path.write_text(json.dumps({
        "routine_id": result.routine_id,
        "started_at": result.started_at,
        "finished_at": result.finished_at,
        "status": result.status,
        "output": result.output,
        "error": result.error,
    }, indent=2), "utf-8")


def get_run_history(routine_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    if not HISTORY_DIR.exists():
        return []
    results = []
    for f in sorted(HISTORY_DIR.glob(f"{routine_id}_*.json"), reverse=True)[:limit]:
        try:
            results.append(json.loads(f.read_text("utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    return results
