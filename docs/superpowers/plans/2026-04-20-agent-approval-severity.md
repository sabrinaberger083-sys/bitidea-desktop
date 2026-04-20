# Agent Approval Severity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add severity tiers (read/write/destructive/network/unknown) to the agent approval UX — classifier in the sidecar, extended SSE protocol, tiered ApprovalModal with destructive-tier friction, tool-specific preview rendering, and an auto-allowed countdown badge on ToolCard.

**Architecture:** A pure Python classifier (`classify_tool_severity`) runs in `agent_bridge.py` before every `approval_request` SSE emit. Same file's `ApprovalRegistry` gains expiry return; `AgentRunner` stashes recently-cached command expiries so the next matching `tool_start` event can carry `auto_allowed` + `allowed_until_ms`. Frontend adds one shared `renderToolPreview` helper (consumed by both `ApprovalModal` and `ToolCard`), a `SEV_CONFIG` lookup for tier-specific copy/color, a `useCountdown` hook, and destructive-tier keyboard lockout.

**Tech Stack:** Python 3.11 (FastAPI, pytest), TypeScript 5.8, React 19, Vite 7, existing CSS custom props.

**Scope note:** Backend has pytest in this plan (cheap setup, classifier has ~30 test cases — high leverage). Frontend has no test runner today; adding vitest would be a ~30 min detour for one component. We rely on `npx tsc --noEmit` + a manual smoke checklist in the final task. The spec's "Component test" line is deferred as a follow-up.

**Branch:** `feat/agent-integration` (continues from the subagent's Phase D work).

---

## File Structure

### Created

- `sidecar/pytest.ini` — pytest config (testpaths, asyncio mode if needed).
- `sidecar/tests/__init__.py` — package marker.
- `sidecar/tests/test_severity.py` — table-driven tests for the classifier.
- `sidecar/tests/test_approval_cache.py` — tests for `check_remember` expiry + destructive bypass.
- `src/components/Chat/renderToolPreview.tsx` — shared tool→ReactNode helper used by modal and card.
- `src/components/Chat/useCountdown.ts` — `useCountdown(untilMs)` hook returning remaining seconds or `null`.

### Modified

- `sidecar/requirements.txt` — add `pytest>=8.0`.
- `sidecar/agent_bridge.py`:
  - Add `Severity` type alias and `classify_tool_severity`.
  - Extend `ApprovalRegistry.check_remember` to return `(hit: bool, expires_at: Optional[float])`.
  - Extend `ApprovalRegistry` with `block_cache_for_destructive(tool_name, args)` no-op helper (explicit bypass pathway).
  - In `AgentRunner`, add `_recent_auto_allowed: list[tuple[str, float]]` FIFO (max 8) of `(command, expires_at)` pairs.
  - In `_make_notify_cb.notify`, call classifier; on cache-hit push the pair into `_recent_auto_allowed`; emit `severity` in `approval_request`.
  - In `_make_callbacks.tool_progress`, consume matching `_recent_auto_allowed` entry and attach `auto_allowed`/`allowed_until_ms` to `tool_start`.
- `src/types/index.ts` — add `Severity`, extend `ApprovalRequest` + `ToolEvent`.
- `src/lib/sidecar.ts` — parse new fields in `parseFrame`.
- `src/components/Chat/ApprovalModal.tsx` + `ApprovalModal.css` — `SEV_CONFIG`, tiered styling, destructive keyboard lockout, default-focus switch, hidden remember for destructive.
- `src/components/Chat/ToolCard.tsx` + `ToolCard.css` — badge render, `useCountdown` integration, shared preview.

### Untouched

- `src-tauri/*` — no Rust changes needed.
- `sidecar/server.py` — `/chat` and `/approval` handler shapes unchanged; new fields piggyback on existing events/bodies.
- `src/components/Chat/ChatWindow.tsx` — consumes `ApprovalRequest.severity` transparently via the updated type.

---

## Task 1: Add pytest infrastructure to sidecar

**Files:**
- Modify: `sidecar/requirements.txt`
- Create: `sidecar/pytest.ini`
- Create: `sidecar/tests/__init__.py`

- [ ] **Step 1: Add pytest to requirements**

Append to `sidecar/requirements.txt`:
```
pytest>=8.0
```

- [ ] **Step 2: Install into existing venv**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pip install -r requirements.txt
```
Expected: `Successfully installed pytest-8.x.x` (or "already satisfied" if present).

- [ ] **Step 3: Write pytest config**

Create `sidecar/pytest.ini`:
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -ra --strict-markers
```

- [ ] **Step 4: Create empty test package**

Create `sidecar/tests/__init__.py` (empty file).

- [ ] **Step 5: Verify pytest runs with zero tests**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pytest
```
Expected: exit code `5` or `0` with message `no tests ran`. Either is acceptable at this step.

- [ ] **Step 6: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add sidecar/requirements.txt sidecar/pytest.ini sidecar/tests/__init__.py
git commit -m "test(sidecar): add pytest infrastructure

Adds pytest>=8.0 dependency, pytest.ini config, and empty tests package.
No tests yet — next commit adds the severity classifier test suite."
```

---

## Task 2: Severity classifier — failing tests first

**Files:**
- Create: `sidecar/tests/test_severity.py`

- [ ] **Step 1: Write the failing test file**

Create `sidecar/tests/test_severity.py`:
```python
"""Table-driven tests for classify_tool_severity."""
import pytest

from agent_bridge import classify_tool_severity


# ---- tool-name-based classification ----------------------------------------

@pytest.mark.parametrize(
    "tool_name,args,expected",
    [
        # read tier by tool name
        ("read_file", {"path": "/tmp/x"}, "read"),
        ("list_files", {"path": "/tmp"}, "read"),
        ("grep", {"pattern": "foo"}, "read"),
        ("glob", {"pattern": "**/*.py"}, "read"),
        # write tier by tool name
        ("write_file", {"path": "/tmp/x", "content": "y"}, "write"),
        ("edit_file", {"path": "/tmp/x"}, "write"),
        ("create_file", {"path": "/tmp/x"}, "write"),
        # destructive by tool name
        ("delete_file", {"path": "/tmp/x"}, "destructive"),
        ("rmdir", {"path": "/tmp/x"}, "destructive"),
        # network by tool name
        ("http_get", {"url": "https://example.com"}, "network"),
        ("http_post", {"url": "https://example.com"}, "network"),
        ("fetch", {"url": "https://example.com"}, "network"),
    ],
)
def test_tool_name_classification(tool_name, args, expected):
    assert classify_tool_severity(tool_name, args) == expected


# ---- URL-in-args fallback --------------------------------------------------

def test_url_in_args_maps_to_network():
    assert classify_tool_severity("unknown_tool", {"target": "https://x.com/y"}) == "network"
    assert classify_tool_severity("unknown_tool", {"target": "http://x.com/"}) == "network"


# ---- shell parser (terminal tool) ------------------------------------------

@pytest.mark.parametrize(
    "command,expected",
    [
        # destructive
        ("rm -rf /tmp/x", "destructive"),
        ("rm -r /tmp/x", "destructive"),
        ("  rm -rf ~/Desktop/photos  ", "destructive"),  # leading/trailing ws
        ("mv /tmp/a /tmp/b", "destructive"),
        ("dd if=/dev/zero of=/tmp/x", "destructive"),
        ("git reset --hard origin/main", "destructive"),
        ("git push --force origin main", "destructive"),
        ("git push -f origin main", "destructive"),
        # network
        ("curl https://example.com", "network"),
        ("wget https://example.com/x.tar", "network"),
        ("ssh user@host", "network"),
        ("scp a b user@host:/tmp/", "network"),
        # write
        ("mkdir /tmp/x", "write"),
        ("touch /tmp/x", "write"),
        ("cp a b", "write"),
        ("sed -i 's/foo/bar/' file", "write"),
        # read
        ("ls -la", "read"),
        ("cat /etc/hosts", "read"),
        ("head -n 5 file", "read"),
        ("grep foo file", "read"),
        ("pwd", "read"),
        ("echo hello", "read"),
        # unknown
        ("somebinary --flag", "unknown"),
        ("", "unknown"),  # empty command
    ],
)
def test_shell_parser(command, expected):
    assert classify_tool_severity("terminal", {"command": command}) == expected


# ---- edge cases ------------------------------------------------------------

def test_rm_without_dangerous_flag_is_still_destructive():
    """Bare `rm file` is still destructive even without -rf."""
    assert classify_tool_severity("terminal", {"command": "rm /tmp/x"}) == "destructive"


def test_git_push_without_force_is_not_destructive():
    """Regular git push is not destructive."""
    assert classify_tool_severity("terminal", {"command": "git push origin main"}) == "unknown"


def test_terminal_without_command_arg_is_unknown():
    assert classify_tool_severity("terminal", {}) == "unknown"
    assert classify_tool_severity("terminal", {"command": None}) == "unknown"


def test_fallback_is_unknown():
    assert classify_tool_severity("completely_novel_tool", {"foo": "bar"}) == "unknown"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pytest tests/test_severity.py -v
```
Expected: `ImportError: cannot import name 'classify_tool_severity' from 'agent_bridge'` — all tests error at import time.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add sidecar/tests/test_severity.py
git commit -m "test(severity): add failing table-driven tests for classifier"
```

---

## Task 3: Severity classifier — implement

**Files:**
- Modify: `sidecar/agent_bridge.py` (add imports + new code near top of file, below the existing imports)

- [ ] **Step 1: Add classifier to agent_bridge.py**

Insert after the `import` block (after line 73, below `logger = ...`) and before the "Approval state" comment:

```python
# ---------------------------------------------------------------------------
# Severity classification
# ---------------------------------------------------------------------------

from typing import Literal

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
_SHELL_READ_FIRST_TOKENS = {"ls", "cat", "head", "tail", "grep", "find", "pwd", "echo", "which"}


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
    if stripped.startswith("git push") and (" --force" in stripped or " -f " in stripped or stripped.endswith(" -f")):
        return "destructive"

    # Destructive prefix tokens (rm, mv, dd).
    first = stripped.split(None, 1)[0]
    if first in _SHELL_DESTRUCTIVE_EXACT:
        return "destructive"
    if any(stripped.startswith(p) for p in _SHELL_DESTRUCTIVE_PREFIXES):
        return "destructive"

    # sed -i is a write (in-place file edit); bare sed would be read but we lump all under write for safety.
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
```

Note: the existing file already imports `Dict`, `Any`, so no additional imports other than `Literal`.

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pytest tests/test_severity.py -v
```
Expected: all tests pass. If any fail, adjust the classifier (not the tests) — tests are the spec.

- [ ] **Step 3: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add sidecar/agent_bridge.py
git commit -m "feat(severity): implement classify_tool_severity

Pure function mapping (tool_name, args) to one of read/write/destructive/
network/unknown. Biases toward unknown->write at render time so the UI
prompts when in doubt."
```

---

## Task 4: ApprovalRegistry.check_remember returns expiry + destructive bypass tests

**Files:**
- Modify: `sidecar/agent_bridge.py`
- Create: `sidecar/tests/test_approval_cache.py`

- [ ] **Step 1: Write failing tests**

Create `sidecar/tests/test_approval_cache.py`:
```python
"""Tests for ApprovalRegistry.check_remember return shape and destructive bypass."""
import time

import pytest

from agent_bridge import ApprovalRegistry


def test_miss_returns_false_and_none():
    reg = ApprovalRegistry()
    hit, expires_at = reg.check_remember("rm-stuff", {"command": "rm -rf x"})
    assert hit is False
    assert expires_at is None


def test_hit_returns_true_and_future_expiry():
    reg = ApprovalRegistry()
    # Simulate the write path: resolve with remember=True.
    req = reg.register_pending("mkdir", {"command": "mkdir x"})
    assert reg.resolve(req.request_id, allow=True, remember=True) is True

    before = time.monotonic()
    hit, expires_at = reg.check_remember("mkdir", {"command": "mkdir x"})
    assert hit is True
    assert expires_at is not None
    # Expiry should be ~60s in the future, but give ourselves slack.
    assert expires_at > before + 55
    assert expires_at <= before + 61


def test_expired_entry_is_evicted():
    reg = ApprovalRegistry()
    req = reg.register_pending("mkdir", {"command": "mkdir y"})
    reg.resolve(req.request_id, allow=True, remember=True)

    # Force-expire by rewriting the internal entry (test-only poke).
    key = ApprovalRegistry._cache_key("mkdir", {"command": "mkdir y"})
    reg._remember[key].expires_at = time.monotonic() - 1.0

    hit, expires_at = reg.check_remember("mkdir", {"command": "mkdir y"})
    assert hit is False
    assert expires_at is None


def test_remember_false_does_not_cache():
    reg = ApprovalRegistry()
    req = reg.register_pending("cmd", {"a": 1})
    reg.resolve(req.request_id, allow=True, remember=False)
    hit, _ = reg.check_remember("cmd", {"a": 1})
    assert hit is False


def test_deny_does_not_cache():
    reg = ApprovalRegistry()
    req = reg.register_pending("cmd", {"a": 1})
    reg.resolve(req.request_id, allow=False, remember=True)
    hit, _ = reg.check_remember("cmd", {"a": 1})
    assert hit is False


def test_cache_key_stable_across_arg_order():
    key1 = ApprovalRegistry._cache_key("t", {"a": 1, "b": 2})
    key2 = ApprovalRegistry._cache_key("t", {"b": 2, "a": 1})
    assert key1 == key2


def test_cache_key_handles_unserialisable_args():
    """Non-JSON-safe args shouldn't crash."""
    # Nested object with a callable — json.dumps would raise. The key method
    # must still produce a deterministic string (via default=str or repr fallback).
    bad_args = {"callable": lambda x: x}
    key = ApprovalRegistry._cache_key("t", bad_args)
    assert isinstance(key, str)
    assert key.startswith("t::")
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pytest tests/test_approval_cache.py -v
```
Expected: `test_miss_returns_false_and_none` fails with tuple-unpacking error (current `check_remember` returns bool, not tuple). Most other tests fail similarly.

- [ ] **Step 3: Update `check_remember` to return tuple**

In `sidecar/agent_bridge.py`, replace the `check_remember` method (currently at lines 160-170):

```python
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
```

- [ ] **Step 4: Update the existing caller in `notify` to unpack the tuple**

In the same file, find the block that reads (currently line ~397):
```python
            if APPROVALS.check_remember(tool_name, args):
```
Replace with:
```python
            hit, _expires_at = APPROVALS.check_remember(tool_name, args)
            if hit:
```
(We'll use `_expires_at` in Task 5 — for now leave the `_` prefix to mark unused.)

- [ ] **Step 5: Run all sidecar tests to verify green**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pytest -v
```
Expected: all severity + cache tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add sidecar/agent_bridge.py sidecar/tests/test_approval_cache.py
git commit -m "feat(approval): return expiry from check_remember

The remember cache now exposes the absolute expires_at (monotonic clock)
so callers can propagate the deadline to clients. All existing callers
are updated to unpack the tuple. No behaviour change for the notify
path yet — expiry is wired into SSE events in the next commit."
```

---

## Task 5: Wire severity into `approval_request` and auto_allowed into `tool_start`

**Files:**
- Modify: `sidecar/agent_bridge.py`

- [ ] **Step 1: Add `_recent_auto_allowed` FIFO to AgentRunner**

In `sidecar/agent_bridge.py`, find the `AgentRunner.__init__` method (line ~250). Add a new field at the end of `__init__`:

```python
        # FIFO of (command, expires_at_epoch_ms) pairs — populated when the
        # remember cache short-circuits a notify(), consumed by the next
        # matching tool_start event so the ToolCard can render an
        # auto-allowed badge with a live countdown.
        self._recent_auto_allowed: List["tuple[str, int]"] = []
        self._recent_lock = threading.Lock()
```

Also add `List` and `tuple` to the typing imports at the top if not already present (they are — `List` is imported, and `tuple` is a builtin in 3.9+).

- [ ] **Step 2: Populate `_recent_auto_allowed` on cache hit**

In `_make_notify_cb.notify`, replace the cache-hit branch (currently lines ~397-405):

```python
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
```

- [ ] **Step 3: Add severity to `approval_request` SSE frame**

In the same `notify` function, replace the `approval_request` push block (currently lines ~409-417):

```python
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
```

- [ ] **Step 4: Consume `_recent_auto_allowed` in tool_progress**

In `_make_callbacks.tool_progress`, replace the push block (currently lines ~316-321):

```python
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
```

- [ ] **Step 5: Smoke-import the module to catch syntax errors**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
python -c "import agent_bridge; print('ok')"
```
Expected: `ok`.

- [ ] **Step 6: Run all sidecar tests**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/sidecar
source .venv/bin/activate
pytest -v
```
Expected: all pass (tests don't cover the runner plumbing, but nothing should have regressed).

- [ ] **Step 7: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add sidecar/agent_bridge.py
git commit -m "feat(sse): add severity to approval_request and auto_allowed to tool_start

approval_request now carries severity so the modal can render the
correct tier. tool_start carries auto_allowed+allowed_until_ms when
the preceding approval was short-circuited by the 60s remember cache
so the ToolCard can show a countdown badge."
```

---

## Task 6: Frontend types + SSE parser

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/sidecar.ts`

- [ ] **Step 1: Add Severity + extend types**

In `src/types/index.ts`, find the existing `ApprovalRequest` and `ToolEvent` type definitions. Replace `ApprovalRequest` with:

```ts
export type Severity = 'read' | 'write' | 'destructive' | 'network' | 'unknown';

export interface ApprovalRequest {
  request_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  preview: string;
  severity: Severity;
}
```

Then extend `ToolEvent` — find its definition and add the two optional fields:
```ts
export interface ToolEvent {
  // ... existing fields
  auto_allowed?: boolean;
  allowed_until_ms?: number;
}
```
(Keep every existing field intact — only add those two lines.)

- [ ] **Step 2: Parse new fields in SSE frame parser**

Open `src/lib/sidecar.ts`. Find the SSE `parseFrame`/`dispatch` logic that builds approval requests and tool events. For the `approval_request` case, ensure the dispatched object passes through `severity` (default to `'unknown'` if the sidecar omits it for back-compat):

```ts
case 'approval_request': {
  const req: ApprovalRequest = {
    request_id: String(data.request_id ?? ''),
    tool_name: String(data.tool_name ?? ''),
    args: (data.args as Record<string, unknown>) ?? {},
    preview: String(data.preview ?? ''),
    severity: (data.severity as Severity) ?? 'unknown',
  };
  handlers.onApprovalRequest?.(req);
  break;
}
```

For `tool_start`, pass through the new optional fields:
```ts
case 'tool_start': {
  handlers.onToolStart?.({
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    args: (data.args as Record<string, unknown>) ?? {},
    preview: String(data.preview ?? ''),
    auto_allowed: data.auto_allowed === true ? true : undefined,
    allowed_until_ms:
      typeof data.allowed_until_ms === 'number' ? data.allowed_until_ms : undefined,
  });
  break;
}
```

If the exact shape of parseFrame in the current file differs (the subagent's version may use a different dispatch style), adapt minimally — the test is that `ApprovalRequest.severity` reaches the React tree and `ToolEvent.auto_allowed` plus `allowed_until_ms` reach `ToolCard`.

- [ ] **Step 3: Verify types compile**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add src/types/index.ts src/lib/sidecar.ts
git commit -m "feat(frontend): propagate severity and auto_allowed through SSE

Adds Severity union + extends ApprovalRequest.severity and
ToolEvent.auto_allowed/allowed_until_ms. Sidecar client parses both
with safe fallbacks so an older backend (no severity field) degrades
to 'unknown' rather than crashing."
```

---

## Task 7: Shared `renderToolPreview` helper

**Files:**
- Create: `src/components/Chat/renderToolPreview.tsx`

- [ ] **Step 1: Write the helper**

Create `src/components/Chat/renderToolPreview.tsx`:

```tsx
import type { ReactNode } from 'react';

const SHELL_TOOL_NAMES = new Set(['terminal', 'shell', 'bash', 'execute_command']);
const NETWORK_TOOL_NAMES = new Set(['http_get', 'http_post', 'fetch']);
const FILE_WRITE_TOOL_NAMES = new Set(['write_file', 'edit_file', 'create_file']);

function firstString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function renderShell(command: string): ReactNode {
  const [head, ...rest] = command.split(/(\s+)/); // keep whitespace tokens
  return (
    <pre className="tool-preview-shell">
      <span className="tool-preview-prompt">$ </span>
      <span className="tool-preview-cmd-head">{head}</span>
      {rest.join('')}
    </pre>
  );
}

function renderFileWrite(args: Record<string, unknown>): ReactNode {
  const path = firstString(args, ['path', 'file_path', 'filename']);
  const content = firstString(args, ['content', 'text']);
  return (
    <div className="tool-preview-file">
      {path && <div className="tool-preview-path">{path}</div>}
      {content && content.length < 400 && (
        <pre className="tool-preview-content">{content}</pre>
      )}
    </div>
  );
}

function renderNetwork(args: Record<string, unknown>): ReactNode {
  const method =
    (firstString(args, ['method']) ?? 'GET').toUpperCase();
  const url = firstString(args, ['url', 'endpoint']) ?? '';
  return (
    <pre className="tool-preview-network">
      <span className="tool-preview-method">{method}</span> {url}
    </pre>
  );
}

function renderJson(args: Record<string, unknown>): ReactNode {
  return <pre className="tool-preview-json">{JSON.stringify(args, null, 2)}</pre>;
}

/**
 * Render a tool invocation's args in a human-legible form. Used by both
 * ApprovalModal (for the request preview) and ToolCard (for the header /
 * expanded body).
 */
export function renderToolPreview(
  toolName: string,
  args: Record<string, unknown>,
): ReactNode {
  const name = (toolName ?? '').toLowerCase();
  if (SHELL_TOOL_NAMES.has(name)) {
    const cmd = firstString(args, ['command']);
    if (cmd) return renderShell(cmd);
    return renderJson(args);
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    return renderFileWrite(args);
  }
  if (NETWORK_TOOL_NAMES.has(name)) {
    return renderNetwork(args);
  }
  return renderJson(args);
}

/** One-line text preview for use in collapsed headers. */
export function renderToolPreviewLine(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const name = (toolName ?? '').toLowerCase();
  if (SHELL_TOOL_NAMES.has(name)) {
    const cmd = firstString(args, ['command']);
    if (cmd) return `$ ${cmd}`;
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    const path = firstString(args, ['path', 'file_path', 'filename']);
    if (path) return path;
  }
  if (NETWORK_TOOL_NAMES.has(name)) {
    const method = (firstString(args, ['method']) ?? 'GET').toUpperCase();
    const url = firstString(args, ['url', 'endpoint']) ?? '';
    return `${method} ${url}`.trim();
  }
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add src/components/Chat/renderToolPreview.tsx
git commit -m "feat(chat): shared renderToolPreview for modal + card

Terminal tools render as \`\$ cmd\` with the first token styled.
File writes show path plus optional inline content preview. Network
tools show METHOD + URL. Unknown tools fall back to pretty JSON.
Also exposes renderToolPreviewLine for collapsed one-line headers."
```

---

## Task 8: ApprovalModal — severity tiers

**Files:**
- Modify: `src/components/Chat/ApprovalModal.tsx`
- Modify: `src/components/Chat/ApprovalModal.css`

- [ ] **Step 1: Replace the component with tier-aware rendering**

Open `src/components/Chat/ApprovalModal.tsx`. Replace the `COPY` object + the component body with:

```tsx
import { useEffect, useRef, useState } from 'react';
import Button from '../common/Button';
import type { ApprovalRequest, Lang, Severity } from '../../types';
import { renderToolPreview } from './renderToolPreview';
import './ApprovalModal.css';

type TierCopy = {
  title: string;
  sub: string;
};

const SEV_CONFIG: Record<
  Severity,
  { glyph: string; cls: string; copy: Record<Lang, TierCopy> }
> = {
  read: {
    glyph: 'ℹ',
    cls: 'approve-read',
    copy: {
      zh: { title: '读取', sub: '代理想读取以下资源。' },
      en: { title: 'Read', sub: 'The agent wants to read:' },
    },
  },
  write: {
    glyph: '◆',
    cls: 'approve-write',
    copy: {
      zh: { title: '修改', sub: '代理想修改以下内容。' },
      en: { title: 'Modify', sub: 'The agent wants to modify:' },
    },
  },
  destructive: {
    glyph: '⚠',
    cls: 'approve-destructive',
    copy: {
      zh: {
        title: '不可逆操作',
        sub: '代理想执行一个无法撤回的操作，请确认后再继续。',
      },
      en: {
        title: 'Irreversible',
        sub: 'The agent wants to take an irreversible action. Confirm before proceeding.',
      },
    },
  },
  network: {
    glyph: '→',
    cls: 'approve-network',
    copy: {
      zh: { title: '网络请求', sub: '代理想向外部服务发起请求。' },
      en: { title: 'Network', sub: 'The agent wants to reach an external service:' },
    },
  },
  unknown: {
    glyph: '◆',
    cls: 'approve-write', // visual alias of write (amber, cautious)
    copy: {
      zh: { title: '未分类操作', sub: '代理想执行一个未知类别的操作。' },
      en: { title: 'Unclassified', sub: 'The agent wants to take an action we could not classify:' },
    },
  },
};

const SHARED_COPY = {
  en: { remember: 'Remember for 60 seconds', allow: 'Allow', deny: 'Deny', hintAllow: '↵ / ⌘↵', hintDeny: 'Esc' },
  zh: { remember: '记住 60 秒', allow: '允许', deny: '拒绝', hintAllow: '↵ / ⌘↵', hintDeny: 'Esc' },
};

interface Props {
  request: ApprovalRequest | null;
  lang: Lang;
  onResolve: (allow: boolean, remember: boolean) => void;
}

export default function ApprovalModal({ request, lang, onResolve }: Props) {
  const [remember, setRemember] = useState(false);
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);

  const severity: Severity = request?.severity ?? 'unknown';
  const tier = SEV_CONFIG[severity];
  const copy = tier.copy[lang];
  const shared = SHARED_COPY[lang];
  const isDestructive = severity === 'destructive';

  // Reset remember + focus appropriate button per severity.
  useEffect(() => {
    if (!request) return;
    setRemember(false);
    const target = isDestructive ? denyRef : allowRef;
    const t = setTimeout(() => target.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [request?.request_id, isDestructive]);

  // Keyboard shortcuts. Destructive severity disables Enter/Space Allow.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve(false, false);
        return;
      }
      if (isDestructive) return; // no keyboard Allow for destructive.
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey || document.activeElement === allowRef.current)
      ) {
        e.preventDefault();
        onResolve(true, remember);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, remember, onResolve, isDestructive]);

  if (!request) return null;

  return (
    <div
      className="approve-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-title"
    >
      <div className={`approve-card ${tier.cls}`}>
        <div className="approve-head">
          <span className="approve-glyph" aria-hidden>{tier.glyph}</span>
          <span id="approve-title" className="approve-title">{copy.title}</span>
        </div>
        <p className="approve-sub">{copy.sub}</p>

        <div className="approve-preview">
          {renderToolPreview(request.tool_name, request.args)}
        </div>

        {!isDestructive && (
          <label className="approve-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>{shared.remember}</span>
          </label>
        )}

        <div className="approve-actions">
          <Button
            ref={denyRef}
            variant={isDestructive ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onResolve(false, false)}
          >
            {shared.deny}
            <span className="approve-hint">{shared.hintDeny}</span>
          </Button>
          <Button
            ref={allowRef}
            variant={isDestructive ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => onResolve(true, remember)}
            onKeyDown={(e) => {
              if (isDestructive && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
              }
            }}
            aria-description={
              isDestructive
                ? 'Click required — keyboard shortcuts are disabled for this action.'
                : undefined
            }
          >
            {shared.allow}
            {!isDestructive && <span className="approve-hint">{shared.hintAllow}</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

(If the `Button` component doesn't accept `onKeyDown` or `aria-description` yet, add them by extending its props — the subagent already converted it to `forwardRef` so those should flow through. If tsc complains, widen the prop type in `common/Button.tsx` to spread `ButtonHTMLAttributes<HTMLButtonElement>`.)

- [ ] **Step 2: Update CSS to add tier-specific colors**

Open `src/components/Chat/ApprovalModal.css`. Append (do not replace the existing rules):

```css
/* ── Severity tiers ─────────────────────────────────────────── */

.approve-read .approve-glyph,
.approve-read .approve-title {
  color: var(--ink-dim);
  text-shadow: none;
}
.approve-read.approve-card::before {
  background: linear-gradient(90deg, transparent, var(--ink-dim), transparent);
}

.approve-write .approve-glyph,
.approve-write .approve-title {
  color: var(--warning);
}
.approve-write.approve-card::before {
  background: linear-gradient(90deg, transparent, var(--warning), transparent);
}

.approve-destructive .approve-glyph,
.approve-destructive .approve-title {
  color: var(--danger);
  text-shadow: 0 0 12px rgba(220, 38, 38, 0.5);
}
.approve-destructive.approve-card {
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(220, 38, 38, 0.25);
}
.approve-destructive.approve-card::before {
  background: linear-gradient(90deg, transparent, var(--danger), transparent);
}

.approve-network .approve-glyph,
.approve-network .approve-title {
  color: var(--accent-2);
}
.approve-network.approve-card::before {
  background: linear-gradient(90deg, transparent, var(--accent-2), transparent);
}

/* ── Preview surface (replaces the old .approve-cmd only block) ── */

.approve-preview {
  margin: 2px 0 6px;
}
.approve-preview pre,
.approve-preview .tool-preview-file {
  margin: 0;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid var(--panel-border);
  border-radius: var(--r-xs);
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--accent-2);
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.approve-preview .tool-preview-prompt {
  color: var(--ink-faint);
}
.approve-preview .tool-preview-cmd-head {
  color: var(--accent);
  font-weight: 500;
}
.approve-preview .tool-preview-path {
  color: var(--ink);
  font-size: 13px;
  margin-bottom: 6px;
}
.approve-preview .tool-preview-content {
  color: var(--ink-dim);
  font-size: 12px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--panel-border);
  border-radius: var(--r-xs);
  max-height: 120px;
  overflow: auto;
}
.approve-preview .tool-preview-method {
  color: var(--accent);
  font-weight: 500;
  padding-right: 6px;
}
```

If the existing `.approve-cmd` rule isn't used anywhere else after this refactor, leave it in place — it does no harm. The modal now uses `.approve-preview` instead.

- [ ] **Step 3: Verify types + no visual regressions on existing tiers**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add src/components/Chat/ApprovalModal.tsx src/components/Chat/ApprovalModal.css
git commit -m "feat(approval): tiered modal with destructive friction

Five severity tiers (read/write/destructive/network/unknown) swap
glyph, title, subtitle, stripe color, and card box-shadow. Destructive
tier: Deny button gets default focus, Allow button ignores Enter/Space,
remember checkbox is hidden entirely. Preview block now uses the shared
renderToolPreview helper so shell commands render as \`\$ cmd\` instead
of pretty-printed JSON."
```

---

## Task 9: ToolCard — auto-allowed badge + useCountdown hook

**Files:**
- Create: `src/components/Chat/useCountdown.ts`
- Modify: `src/components/Chat/ToolCard.tsx`
- Modify: `src/components/Chat/ToolCard.css`

- [ ] **Step 1: Write the countdown hook**

Create `src/components/Chat/useCountdown.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Returns remaining seconds until `untilMs` (epoch ms), ticking every second.
 * Returns 0 when expired, null when no target was provided.
 *
 * Clock skew safety: if untilMs is already in the past at first render we
 * still return 0 (rather than a negative or null) so the caller can show
 * a frozen badge without a countdown number.
 */
export function useCountdown(untilMs: number | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => {
    if (untilMs === undefined) return null;
    return Math.max(0, Math.round((untilMs - Date.now()) / 1000));
  });

  useEffect(() => {
    if (untilMs === undefined) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const next = Math.max(0, Math.round((untilMs - Date.now()) / 1000));
      setRemaining(next);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [untilMs]);

  return remaining;
}
```

- [ ] **Step 2: Update ToolCard**

Open `src/components/Chat/ToolCard.tsx`. Replace the component body with:

```tsx
import { useState } from 'react';
import type { ToolEvent } from '../../types';
import { useCountdown } from './useCountdown';
import { renderToolPreviewLine } from './renderToolPreview';
import './ToolCard.css';

interface Props {
  tool: ToolEvent;
}

export default function ToolCard({ tool }: Props) {
  const isRunning = tool.result === undefined;
  const ok = tool.result?.ok ?? true;
  const [expanded, setExpanded] = useState(true);

  const statusGlyph = isRunning ? '◇' : ok ? '✓' : '✕';
  const statusClass = isRunning ? 'running' : ok ? 'ok' : 'fail';

  // Prefer the shared renderer's one-line preview (so terminal tools show
  // `$ mkdir x` instead of `{"command":"mkdir x"}`). Fall back to the
  // server-supplied preview string if the helper returns empty.
  const preview =
    renderToolPreviewLine(tool.name, tool.args) ||
    tool.preview?.trim() ||
    '';

  const remaining = useCountdown(tool.allowed_until_ms);
  const showBadge = tool.auto_allowed === true;

  return (
    <div className={`tool-card tool-${statusClass}`}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`tool-glyph tool-glyph-${statusClass}`} aria-hidden>
          {statusGlyph}
        </span>
        <span className="tool-name">{tool.name || 'tool'}</span>
        {preview && <span className="tool-preview">{preview}</span>}
        {showBadge && (
          <span
            className={`tool-auto ${remaining !== null && remaining <= 0 ? 'tool-auto-fade' : ''}`}
            aria-label="auto-allowed via remember cache"
          >
            ✓ auto{remaining !== null && remaining > 0 ? ` · ${remaining}s` : ''}
          </span>
        )}
        <span className="tool-caret" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="tool-body">
          {Object.keys(tool.args).length > 0 && (
            <pre className="tool-args">{JSON.stringify(tool.args, null, 2)}</pre>
          )}
          {tool.output && <pre className="tool-output">{tool.output}</pre>}
          {tool.result && (
            <div className={`tool-result tool-result-${ok ? 'ok' : 'fail'}`}>
              <span className="tool-result-label">
                {ok ? 'RESULT' : 'ERROR'}
                {tool.result.truncated && ' · truncated'}
              </span>
              {tool.result.summary && (
                <pre className="tool-result-body">{tool.result.summary}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add badge CSS**

Append to `src/components/Chat/ToolCard.css`:

```css
.tool-auto {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  margin-left: auto;
  border: 1px solid var(--panel-border);
  border-radius: var(--r-xs);
  background: rgba(34, 197, 94, 0.08);
  color: var(--success);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  transition: opacity 0.4s ease;
}
.tool-auto-fade {
  opacity: 0.3;
}
```

The `margin-left: auto` pushes the badge to the right end of the header, before the caret. If layout breaks, the fix is to remove `margin-left: auto` and instead set `flex: 1` on `.tool-preview` (whichever the current ToolCard layout already uses — inspect first).

- [ ] **Step 4: Verify types compile**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git add src/components/Chat/ToolCard.tsx src/components/Chat/ToolCard.css src/components/Chat/useCountdown.ts
git commit -m "feat(tool-card): auto-allowed countdown badge

Adds a monospace badge on the tool header when a run was auto-approved
via the 60s remember cache, with a live countdown driven by a small
useCountdown hook. Preview line uses the shared renderer so shell
tools show \`\$ cmd\` in the collapsed header."
```

---

## Task 10: Manual smoke test checklist

**Files:** none (verification only).

- [ ] **Step 1: Full static validation pass**

Run the three static checks:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
cd sidecar && source .venv/bin/activate && pytest -v && python -c "import agent_bridge; print('ok')"
cd ../src-tauri && cargo check
```
Expected: tsc clean, pytest all green, agent_bridge imports, cargo Finished. If any fail, stop and fix before smoke.

- [ ] **Step 2: Start the dev app**

In the project root:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
pnpm tauri dev
```
(Or whatever runner is in use — `npm run tauri dev` also works.)

Expected: app launches, sidecar handshake completes, chat is usable.

- [ ] **Step 3: Smoke matrix**

Run each of the following in chat and verify the expected UX:

| Prompt | Expected approval tier | Expected preview format | Expected keyboard behavior |
| --- | --- | --- | --- |
| "在桌面新建文件夹 test-write" | write (琥珀) | `$ mkdir ~/Desktop/test-write` | Enter = Allow, Deny = focused as secondary |
| "在桌面用 curl 请求 https://example.com" | network (青) | `GET https://example.com` or `$ curl ...` | Enter = Allow |
| "删除桌面上的 test-write 文件夹" (agent will issue `rm -rf`) | **destructive (红)** | `$ rm -rf ~/Desktop/test-write` | **Enter does nothing**, Deny is focused, remember checkbox is hidden; Allow only via click |
| "读一下 ~/.bitidea-desktop/config.json 的内容" | read (灰) | `$ cat ~/.bitidea-desktop/config.json` | Enter = Allow |

If bitidea-agent's approval gateway doesn't flag `read`-tier commands (likely — read is usually safe), the read row may not produce a modal at all. That's acceptable; the classifier still runs when the modal does fire, and unknown→write is our bias.

- [ ] **Step 4: Remember cache smoke**

1. Prompt: "在桌面新建文件夹 cache-test-1"
2. Modal appears. Check **Remember for 60 seconds**, click Allow.
3. Prompt immediately: "在桌面再新建文件夹 cache-test-2 用同一个 mkdir 命令格式"
4. Expected: no modal for any `mkdir` that was already approved; ToolCard shows `[✓ auto · 54s]` badge counting down.
5. Wait 60+ seconds, prompt again with the same command family.
6. Expected: modal returns.

Note: the remember cache is keyed on the *exact* shell command string (`args.command`), so `mkdir foo` being remembered does NOT auto-allow `mkdir bar`. This is by design.

- [ ] **Step 5: Destructive friction smoke**

1. Prompt: "删除桌面上的 cache-test-1"
2. Modal appears in **destructive** tier (red, ⚠).
3. Press Enter on the focused Deny button. Expected: denied immediately.
4. Prompt the same again.
5. Modal reappears. Press Enter while nothing is focused.
6. Expected: **nothing happens** — no Allow, no Deny (Enter while nothing focused shouldn't fire keyboard handler).
7. Press Esc.
8. Expected: denied.
9. Prompt the same again.
10. Click Allow with the mouse.
11. Expected: agent proceeds. Remember checkbox was not visible in any of steps 2–10.

- [ ] **Step 6: Commit the smoke checklist (optional doc commit)**

If any issues found, fix them in a new commit and re-run. If everything passes, the branch is ready for review.

```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
git log --oneline main..feat/agent-integration
```
Expected: the four original subagent commits from Phase D, the earlier spec-doc commit, plus this plan's ~9 incremental commits.

---

## Self-review against spec

Spec coverage check:

- ✅ §1 Backend severity classifier — Task 2 (tests) + Task 3 (implementation), all rule rows covered.
- ✅ §2 SSE protocol changes — Task 5 (backend emit) + Task 6 (frontend parse).
- ✅ §3 ApprovalModal tiered rendering — Task 8 covers the SEV_CONFIG, class swap, copy, stripe.
- ✅ §4 Tool-specific preview rendering — Task 7 (renderToolPreview helper), consumed in both modal (Task 8) and ToolCard (Task 9).
- ✅ §5 Auto-allowed badge on ToolCard — Task 5 (backend piggyback) + Task 9 (frontend countdown + badge).
- ✅ §6 Destructive friction — Task 8 covers Enter/Space lockout, default focus, hidden remember, aria-description.
- ✅ Risks (spec §Risks) — classifier tests cover edge cases (risk 1); cache key test covers non-JSON args crash (risk 3). Risk 2 (wrong tool names) is mitigated by the classifier's `_SHELL_TOOL_NAMES` tolerating `terminal`/`shell`/`bash`/`execute_command`. Risk 4 (clock skew) is handled in `useCountdown`'s past-timestamp branch.
- ✅ Out-of-scope items are not in any task (setting for auto-allow-all-reads, user overrides, diff preview, approval log).

Placeholder scan: no TBD / TODO / "add appropriate X" / "handle edge cases" tokens present.

Type consistency:
- `Severity` union is identical in `types/index.ts`, `renderToolPreview.tsx`, `ApprovalModal.tsx`.
- `ApprovalRequest.severity` and `ToolEvent.auto_allowed`/`allowed_until_ms` naming is consistent across backend emit (Task 5), frontend parse (Task 6), and consumer (Task 9).
- `classify_tool_severity` signature `(str, dict) -> Severity` is consistent in the classifier implementation and the `notify` callsite.

No unresolved gaps.
