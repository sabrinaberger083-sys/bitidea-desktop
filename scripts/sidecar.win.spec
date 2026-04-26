# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPEC).resolve().parents[1]
ENGINE = ROOT / "engine"

hiddenimports = sorted(
    set(
        collect_submodules("sidecar")
        + [
            "run_agent",
            "model_tools",
            "toolsets",
            "toolset_distributions",
            "bitidea_constants",
            "utils",
            "bitidea_cli.env_loader",
            "tools.approval",
            "tools.skills_sync",
            "tools.transcription_tools",
            "tools.tts_tool",
            "tools.vision_tools",
        ]
    )
)

datas = [(str(ENGINE), "engine")]


a = Analysis(
    [str(ROOT / "sidecar" / "__main__.py")],
    pathex=[str(ROOT), str(ENGINE)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
