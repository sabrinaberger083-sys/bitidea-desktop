"""
Shared platform registry for Bitidea Agent.

Single source of truth for platform metadata consumed by both
skills_config (label display) and tools_config (default toolset
resolution).  Import ``PLATFORMS`` from here instead of maintaining
duplicate dicts in each module.
"""

from collections import OrderedDict
from typing import NamedTuple


class PlatformInfo(NamedTuple):
    """Metadata for a single platform entry."""
    label: str
    default_toolset: str


# Ordered so that TUI menus are deterministic.
PLATFORMS: OrderedDict[str, PlatformInfo] = OrderedDict([
    ("cli",            PlatformInfo(label="🖥️  CLI",            default_toolset="bitidea-cli")),
    ("telegram",       PlatformInfo(label="📱 Telegram",        default_toolset="bitidea-telegram")),
    ("discord",        PlatformInfo(label="💬 Discord",         default_toolset="bitidea-discord")),
    ("slack",          PlatformInfo(label="💼 Slack",           default_toolset="bitidea-slack")),
    ("whatsapp",       PlatformInfo(label="📱 WhatsApp",        default_toolset="bitidea-whatsapp")),
    ("signal",         PlatformInfo(label="📡 Signal",          default_toolset="bitidea-signal")),
    ("bluebubbles",    PlatformInfo(label="💙 BlueBubbles",     default_toolset="bitidea-bluebubbles")),
    ("email",          PlatformInfo(label="📧 Email",           default_toolset="bitidea-email")),
    ("homeassistant",  PlatformInfo(label="🏠 Home Assistant",  default_toolset="bitidea-homeassistant")),
    ("mattermost",     PlatformInfo(label="💬 Mattermost",      default_toolset="bitidea-mattermost")),
    ("matrix",         PlatformInfo(label="💬 Matrix",          default_toolset="bitidea-matrix")),
    ("dingtalk",       PlatformInfo(label="💬 DingTalk",        default_toolset="bitidea-dingtalk")),
    ("feishu",         PlatformInfo(label="🪽 Feishu",          default_toolset="bitidea-feishu")),
    ("wecom",          PlatformInfo(label="💬 WeCom",           default_toolset="bitidea-wecom")),
    ("wecom_callback", PlatformInfo(label="💬 WeCom Callback",  default_toolset="bitidea-wecom-callback")),
    ("weixin",         PlatformInfo(label="💬 Weixin",          default_toolset="bitidea-weixin")),
    ("qqbot",          PlatformInfo(label="💬 QQBot",           default_toolset="bitidea-qqbot")),
    ("webhook",        PlatformInfo(label="🔗 Webhook",         default_toolset="bitidea-webhook")),
    ("api_server",     PlatformInfo(label="🌐 API Server",      default_toolset="bitidea-api-server")),
])


def platform_label(key: str, default: str = "") -> str:
    """Return the display label for a platform key, or *default*."""
    info = PLATFORMS.get(key)
    return info.label if info is not None else default
