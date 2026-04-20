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
