"""Simple scheduler for AI routines.

Runs as a background asyncio task. Every 60 seconds, checks which routines
are due and dispatches them to the agent.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Callable, Coroutine, Dict, Optional

from .routines import Routine, RunResult, load_routines, save_routines, save_run_result

logger = logging.getLogger("sidecar.scheduler")


def _is_due(routine: Routine, now: datetime) -> bool:
    """Check if a routine should run now based on its cron expression.

    Simplified cron:
    - "HH:MM" = daily at that time
    - "*/N" = every N minutes
    """
    if not routine.enabled:
        return False

    cron = routine.cron.strip()

    # Every N minutes pattern
    if cron.startswith("*/"):
        try:
            interval_minutes = int(cron[2:])
        except ValueError:
            return False
        if routine.last_run_at is None:
            return True
        elapsed_minutes = (time.time() * 1000 - routine.last_run_at) / 60000
        return elapsed_minutes >= interval_minutes

    # Daily at HH:MM pattern
    if ":" in cron:
        try:
            hour, minute = map(int, cron.split(":"))
        except ValueError:
            return False
        if now.hour != hour or now.minute != minute:
            return False
        # Only run once per minute window
        if routine.last_run_at:
            last_run = datetime.fromtimestamp(routine.last_run_at / 1000)
            if last_run.date() == now.date() and last_run.hour == hour and last_run.minute == minute:
                return False
        return True

    return False


class RoutineScheduler:
    """Background scheduler that runs due routines."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._running_routines: Dict[str, bool] = {}
        self._run_callback: Optional[Callable] = None

    def set_run_callback(self, cb: Callable) -> None:
        """Set the callback that actually executes a routine prompt."""
        self._run_callback = cb

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())
            logger.info("Routine scheduler started")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            logger.info("Routine scheduler stopped")

    async def run_routine_now(self, routine: Routine) -> RunResult:
        """Execute a routine immediately (manual trigger)."""
        return await self._execute(routine)

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(60)
                await self._check_and_run()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Scheduler loop error")

    async def _check_and_run(self) -> None:
        now = datetime.now()
        routines = load_routines()
        for routine in routines:
            if not routine.enabled:
                continue
            if routine.id in self._running_routines:
                continue
            if _is_due(routine, now):
                asyncio.create_task(self._execute(routine))

    async def _execute(self, routine: Routine) -> RunResult:
        self._running_routines[routine.id] = True
        started_at = int(time.time() * 1000)

        # Update last_run status
        routines = load_routines()
        for r in routines:
            if r.id == routine.id:
                r.last_run_at = started_at
                r.last_status = "running"
        save_routines(routines)

        try:
            if self._run_callback:
                output = await self._run_callback(routine.prompt, routine.project_path)
            else:
                output = "(scheduler: no run callback configured)"

            result = RunResult(
                routine_id=routine.id,
                started_at=started_at,
                finished_at=int(time.time() * 1000),
                status="success",
                output=output,
            )
        except Exception as e:
            result = RunResult(
                routine_id=routine.id,
                started_at=started_at,
                finished_at=int(time.time() * 1000),
                status="error",
                output="",
                error=str(e),
            )
        finally:
            self._running_routines.pop(routine.id, None)

        save_run_result(result)

        # Update routine status
        routines = load_routines()
        for r in routines:
            if r.id == routine.id:
                r.last_run_at = result.finished_at
                r.last_status = result.status
        save_routines(routines)

        return result
