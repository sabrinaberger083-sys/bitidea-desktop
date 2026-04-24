"""Shared helpers for direct xAI HTTP integrations."""

from __future__ import annotations


def bitidea_xai_user_agent() -> str:
    """Return a stable Bitidea-specific User-Agent for xAI HTTP calls."""
    try:
        from bitidea_cli import __version__
    except Exception:
        __version__ = "unknown"
    return f"Bitidea-Agent/{__version__}"
