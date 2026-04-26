"""Tests for image preprocessing status visibility."""

from agent_bridge import AgentRunner


def _runner(messages):
    return AgentRunner(
        provider="custom",
        model="test-model",
        api_key="test-key",
        base_url="http://127.0.0.1:9999/v1",
        messages=messages,
        ui_lang="zh",
    )


def test_history_image_does_not_surface_live_status(monkeypatch):
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "旧图片"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,aaaa"}},
            ],
        },
        {"role": "assistant", "content": "收到"},
        {"role": "user", "content": "纯文本继续"},
    ]
    runner = _runner(messages)
    statuses = []

    monkeypatch.setattr(runner, "_push_status", statuses.append)
    monkeypatch.setattr(
        runner,
        "_describe_image_with_vision",
        lambda image_source, cache_key_source=None: ("图片内容", ""),
    )

    transformed = runner._preprocess_messages_for_image_fallback(messages)

    assert transformed[0]["content"].startswith("[用户附带了一张图片")
    assert not any("正在识别图片" in str(status) for status in statuses)


def test_current_image_still_surfaces_status(monkeypatch):
    messages = [
        {"role": "user", "content": "先聊一句"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "这次有图"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,bbbb"}},
            ],
        },
    ]
    runner = _runner(messages)
    statuses = []

    monkeypatch.setattr(runner, "_push_status", statuses.append)
    monkeypatch.setattr(
        runner,
        "_describe_image_with_vision",
        lambda image_source, cache_key_source=None: ("图片内容", ""),
    )

    runner._preprocess_messages_for_image_fallback(messages)

    assert any("正在识别图片" in str(status) for status in statuses)
