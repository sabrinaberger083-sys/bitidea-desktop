# Bitidea Windows Build

## 目标

- 保持现有 React/Tauri 前端一套代码，同时支持 macOS 和 Windows。
- Windows 交付同时提供：
  - NSIS 安装器 `.exe`
  - 便携压缩包 `.zip`

## 产物

- 安装器：`src-tauri/target/release/bundle/nsis/*.exe`
- 便携包：`dist/windows/Bitidea-<version>-windows-portable.zip`
- Windows sidecar：`src-tauri/bin/sidecar-<target-triple>.exe`

## 本地 Windows 构建

前置条件：

- Node.js 20+
- Rust stable（MSVC toolchain）
- Python 3.11+

命令：

```powershell
npm ci
npm run dist:windows
```

如果只想单独构建安装器或便携包：

```powershell
npm run dist:windows:installer
npm run dist:windows:portable
```

## 打包策略

1. `scripts/build-sidecar-win.ps1` 先用 PyInstaller 生成 Windows `sidecar.exe`。
2. 生成物落到 `src-tauri/bin/sidecar-<target-triple>.exe`。
3. Tauri 通过 `src-tauri/tauri.windows.conf.json` 的 `bundle.externalBin` 自动把它复制成运行时可执行的 `sidecar.exe`。
4. `scripts/smoke-sidecar-win.ps1` 会先做一次 `sidecar.exe` 启动握手烟测，避免“能打包但起不来”。
5. `tauri build --bundles nsis` 生成安装器。
6. `tauri build --no-bundle` 后，`scripts/package-portable-win.ps1` 把 `bitidea-desktop.exe + sidecar.exe` 打成便携包。

## 注意事项

- NSIS 安装器已启用 WebView2 `downloadBootstrapper` 模式，安装时会自动处理 WebView2 运行时。
- 便携包默认依赖系统已经安装 WebView2 Runtime。
- 这套流程只新增 Windows 打包链路，不影响当前 macOS 开发流程。
