"""Tests for frontend status text normalization."""

from agent_bridge import sanitize_status_text


def test_sanitizes_kawaii_spinner_text():
    assert sanitize_status_text("(｡•́︿•̀｡) synthesizing...") == "Thinking..."


def test_sanitizes_cached_approval_notice():
    assert (
        sanitize_status_text("(auto-allowed cached approval: shell-command)")
        == "Using remembered approval"
    )


def test_collapses_whitespace_and_ansi():
    raw = "\x1b[31mStatus:\x1b[0m  syncing\n\nworkspace"
    assert sanitize_status_text(raw) == "Status: syncing workspace"


def test_truncates_very_long_status_lines():
    text = "x" * 300
    sanitized = sanitize_status_text(text)
    assert sanitized.endswith("...")
    assert len(sanitized) == 220
