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
    assert reg.resolve(req.request_id, allow=True, mode="remember") is True

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
    reg.resolve(req.request_id, allow=True, mode="remember")

    # Force-expire by rewriting the internal entry (test-only poke).
    key = ApprovalRegistry._cache_key("mkdir", {"command": "mkdir y"})
    reg._remember[key].expires_at = time.monotonic() - 1.0

    hit, expires_at = reg.check_remember("mkdir", {"command": "mkdir y"})
    assert hit is False
    assert expires_at is None


def test_remember_false_does_not_cache():
    reg = ApprovalRegistry()
    req = reg.register_pending("cmd", {"a": 1})
    reg.resolve(req.request_id, allow=True, mode="once")
    hit, _ = reg.check_remember("cmd", {"a": 1})
    assert hit is False


def test_deny_does_not_cache():
    reg = ApprovalRegistry()
    req = reg.register_pending("cmd", {"a": 1})
    reg.resolve(req.request_id, allow=False, mode="remember")
    hit, _ = reg.check_remember("cmd", {"a": 1})
    assert hit is False


def test_always_allow_bypasses_ttl_cache():
    reg = ApprovalRegistry()
    req = reg.register_pending("cmd", {"command": "mkdir z"})
    assert reg.resolve(req.request_id, allow=True, mode="always") is True
    assert req.result == "always"
    hit, _ = reg.check_remember("cmd", {"command": "mkdir z"})
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


def test_cache_hits_across_asymmetric_call_shapes():
    """Simulate the real runtime: notify writes under a normalized shape,
    tool_progress peeks under raw tool-call shape. Both must hit when the
    underlying command string is the same.
    """
    reg = ApprovalRegistry()
    # Write path: matches notify() in agent_bridge.py line 503-536 (resolve
    # path via register_pending -> resolve with remember=True).
    notify_tool_name = "Destructive rm command"
    notify_args = {
        "command": "rm -rf /tmp/foo",
        "description": notify_tool_name,
        "pattern_key": "rm-recursive",
    }
    req = reg.register_pending(notify_tool_name, notify_args)
    assert reg.resolve(req.request_id, allow=True, mode="remember")

    # Read path: matches tool_progress() at line 419 — raw tool name + raw
    # args dict the LLM passed.
    raw_tool_name = "terminal"
    raw_args = {"command": "rm -rf /tmp/foo", "workdir": "/Users/x", "timeout": 60}
    hit, expires_at = reg.check_remember(raw_tool_name, raw_args)
    assert hit is True, "peek from tool_progress side must hit entry written from notify side"
    assert expires_at is not None


def test_cache_miss_when_command_differs():
    """Same tool name, different command: must not hit."""
    reg = ApprovalRegistry()
    req = reg.register_pending("t", {"command": "rm -rf /tmp/foo"})
    assert reg.resolve(req.request_id, allow=True, mode="remember")

    hit, _ = reg.check_remember("t", {"command": "rm -rf /tmp/bar"})
    assert hit is False


def test_cache_key_ignores_non_command_fields_when_command_present():
    """When a command is present, extra fields like pattern_key or workdir
    must not change the key. This is the property that lets the round-trip work.
    """
    k1 = ApprovalRegistry._cache_key("x", {"command": "ls", "pattern_key": "a"})
    k2 = ApprovalRegistry._cache_key("y", {"command": "ls", "workdir": "/tmp"})
    assert k1 == k2
