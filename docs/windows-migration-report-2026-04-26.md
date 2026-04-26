# Windows 双端改造交付报告

## 本次交付

- 保持现有 Tauri + React 前端一套代码，同时补齐 Windows 运行时与打包链路。
- Windows 交付形式定为：
  - NSIS 安装器 `.exe`
  - 便携压缩包 `.zip`

## 已完成改动

### 运行时

- `src-tauri/src/sidecar.rs`
  - Windows 非 dev 模式优先启动打包后的 `sidecar.exe`
  - dev 模式补充 `.venv/Scripts/python.exe` 检测
  - Windows 子进程增加 `CREATE_NO_WINDOW`，避免 sidecar 控制台闪窗
- `src-tauri/src/lib.rs`
  - `setup` 阶段改为传入 `AppHandle`，让 sidecar 资源路径按真实运行上下文解析
- `sidecar/__main__.py`
  - 支持 PyInstaller 冻结环境下通过 `_MEIPASS` 找到 `engine/`

### 打包链路

- `src-tauri/tauri.windows.conf.json`
  - 使用 `bundle.externalBin` 打包 Windows sidecar
  - Windows 默认目标设为 `nsis`
  - WebView2 安装模式设为 `downloadBootstrapper`
- `scripts/build-sidecar-win.ps1`
  - 用 PyInstaller 生成 `src-tauri/bin/sidecar-<target-triple>.exe`
- `scripts/smoke-sidecar-win.ps1`
  - 对 sidecar 产物做启动握手烟测
- `scripts/package-portable-win.ps1`
  - 将 `bitidea-desktop.exe + sidecar.exe` 打成便携包
- `.github/workflows/windows-build.yml`
  - 新增 Windows 构建与 artifacts 上传流程

### 前端跨平台收口

- `index.html`
  - 去掉桌面端不会稳定生效的远程字体依赖
  - 标题改为 `Bitidea`
- `src/styles/tokens.css`
  - 调整为更稳定的跨平台字体栈
- `src/styles/globals.css`
  - 为不支持 `backdrop-filter` 的环境增加兜底
- `src/lib/path.ts`
  - 增加跨平台 `basename` / 路径折叠逻辑
  - 修复 UNC 路径前缀保留
- `ApprovalModal` / `ProjectPicker`
  - 平台化快捷键提示
  - 将最显眼的符号/emoji 图标替换为 SVG
- 多个滚动容器
  - 增加并微调 `scrollbar-gutter`

## 本地验证结果

当前 macOS 工作区已完成并通过：

- `npm run build`
- `cargo check`
- `cargo fmt --check`
- `python3 -m py_compile sidecar/__main__.py`
- `python3 -c "import json; json.load(open('src-tauri/tauri.windows.conf.json'))"`

## 两轮审查结论

### 第一轮

- Windows UI 静态审查发现：
  - 远程字体在桌面端不可依赖
  - 快捷键文案存在 macOS 写死问题
  - 路径显示和滚动条在 Windows 下容易漂
  - 毛玻璃缺少 fallback

### 第二轮

- Windows 包功能审查补出：
  - 便携包脚本需要兼容 target triple 路径
  - sidecar 需要真正的 smoke test，而不只是 build 成功
- Windows UI 审查补出：
  - UNC 路径显示需要修
  - `scrollbar-gutter: both-edges` 容易让窄容器看起来又套一层框
  - 最显眼的 emoji / 文字符号图标需要替换

以上问题本次已继续修到当前版本。

## 仍保留的剩余风险

- 目前还没有在真实 Windows 机器上完成整包运行验收；当前环境只能做静态和编译层验证。
- 字体虽然已经从“远程依赖”收口为“本地系统栈”，但如果目标是 macOS / Windows 视觉几乎完全一致，后续仍建议引入本地打包字体资源。
- 仍有部分历史界面区域保留 emoji 图标，后续若继续追求双端一致性，建议继续替换成 SVG。
