# Bitidea Agent Windows 安装说明书

> 版本：v0.10.0 | 更新日期：2026-04-22

---

## 目录

1. [系统要求](#1-系统要求)
2. [安装方式一：一键安装（推荐）](#2-安装方式一一键安装推荐)
3. [安装方式二：手动安装（开发者）](#3-安装方式二手动安装开发者)
4. [配置 API Key](#4-配置-api-key)
5. [首次启动](#5-首次启动)
6. [常用命令](#6-常用命令)
7. [可选组件安装](#7-可选组件安装)
8. [目录结构说明](#8-目录结构说明)
9. [常见问题排查](#9-常见问题排查)
10. [卸载](#10-卸载)

---

## 1. 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 (1903+) / Windows 11 |
| Python | 3.11（安装器会自动安装） |
| Git | 必须，用于拉取代码 |
| Node.js | 可选，浏览器工具需要（安装器会自动安装） |
| 磁盘空间 | 约 1 GB |
| 网络 | 需要能访问 GitHub 和 PyPI |

> **注意：** Bitidea Agent 不支持原生 Windows 运行环境的 WSL2 方式。本文档介绍的是 **原生 Windows（PowerShell）** 安装方式，安装脚本会自动处理 Windows 兼容性问题。

---

## 2. 安装方式一：一键安装（推荐）

### 方法 A：PowerShell 一键安装

以 **管理员身份** 打开 PowerShell，执行：

```powershell
irm https://raw.githubusercontent.com/sabrinaberger083-sys/bitidea-agent/main/scripts/install.ps1 | iex
```

### 方法 B：CMD 命令行安装

如果你习惯使用 CMD，打开命令提示符执行：

```cmd
curl -fsSL https://raw.githubusercontent.com/sabrinaberger083-sys/bitidea-agent/main/scripts/install.cmd -o install.cmd && install.cmd && del install.cmd
```

### 一键安装器会自动完成以下步骤

1. 安装 **uv** 包管理器（如果未安装）
2. 安装 **Python 3.11**（如果未安装，通过 uv 自动管理，无需管理员权限）
3. 检测 **Git**（必须提前安装）
4. 安装 **Node.js**（如果未安装，自动通过 winget/下载安装）
5. 安装 **ripgrep** 和 **ffmpeg**（可选工具，通过 winget/choco/scoop 自动安装）
6. 克隆代码仓库到 `%LOCALAPPDATA%\bitidea\bitidea-agent`
7. 创建 Python 虚拟环境并安装所有依赖
8. 配置系统 PATH 环境变量
9. 创建配置文件目录 `%LOCALAPPDATA%\bitidea\`
10. 运行安装向导（可选）

### 安装器可选参数

```powershell
# 下载安装脚本后手动运行，支持以下参数：
.\install.ps1 -NoVenv          # 不创建虚拟环境（全局安装）
.\install.ps1 -SkipSetup       # 跳过安装向导
.\install.ps1 -Branch dev      # 安装指定分支
.\install.ps1 -InstallDir "D:\my-agent"  # 自定义安装目录
```

### 安装完成后

**重启终端**（关闭并重新打开 PowerShell / CMD），然后运行：

```powershell
bitidea --version    # 验证安装
bitidea              # 开始使用
```

---

## 3. 安装方式二：手动安装（开发者）

适合需要修改代码或贡献代码的开发者。

### 3.1 前置依赖

确保已安装以下软件：

```powershell
# 检查 Git
git --version

# 检查 Python (需要 3.11+)
python --version

# 如果没有 Python 3.11，通过 winget 安装：
winget install Python.Python.3.11

# 如果没有 Git：
winget install Git.Git
```

### 3.2 克隆仓库

```powershell
git clone https://github.com/sabrinaberger083-sys/bitidea-agent.git
cd bitidea-agent
```

### 3.3 创建虚拟环境并安装

```powershell
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
.\venv\Scripts\Activate.ps1

# 安装完整版（所有可选依赖）
pip install -e ".[all]"

# 或只安装核心依赖（最小安装）
pip install -e "."
```

> **PowerShell 执行策略问题：** 如果激活虚拟环境时报错，先执行：
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

### 3.4 验证安装

```powershell
bitidea --version
```

---

## 4. 配置 API Key

Bitidea Agent 支持多个 LLM 供应商。你至少需要配置一个 API Key。

### 4.1 使用安装向导（推荐）

```powershell
bitidea setup
```

向导会引导你完成 API Key、模型选择、工具配置等所有设置。

### 4.2 手动编辑配置文件

配置文件位于 `%LOCALAPPDATA%\bitidea\`：

| 文件 | 用途 |
|------|------|
| `.env` | API Key 和环境变量 |
| `config.yaml` | 模型、工具、终端等配置 |
| `SOUL.md` | Agent 人格/语气自定义 |

编辑 `.env` 文件：

```powershell
notepad $env:LOCALAPPDATA\bitidea\.env
```

常用 API Key 配置（取消注释并填入你的 Key）：

```env
# OpenRouter（推荐，支持 200+ 模型）
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx

# 或使用其他供应商：
# GOOGLE_API_KEY=your_key           # Google Gemini
# GLM_API_KEY=your_key              # z.ai / 智谱 GLM
# KIMI_API_KEY=sk-kimi-xxxx         # Kimi / Moonshot
# MINIMAX_API_KEY=your_key          # MiniMax
# XIAOMI_API_KEY=your_key           # 小米 MiMo
```

### 4.3 选择/切换模型

```powershell
bitidea model
```

支持的供应商包括：OpenRouter、Anthropic、OpenAI、Google Gemini、z.ai/GLM、Kimi/Moonshot、MiniMax、小米 MiMo、Hugging Face、Arcee AI、Ollama 等。

---

## 5. 首次启动

```powershell
# 启动交互式 CLI
bitidea

# 在 CLI 中可用的快捷命令：
#   /model          切换模型
#   /tools          配置工具
#   /new            新建对话
#   /skills         浏览技能
#   /compress       压缩上下文
#   /usage          查看用量
```

---

## 6. 常用命令

```powershell
bitidea                  # 启动交互式 CLI
bitidea model            # 选择 LLM 模型
bitidea tools            # 配置工具开关
bitidea config set       # 设置配置项
bitidea config edit      # 用编辑器打开配置文件
bitidea setup            # 重新运行安装向导
bitidea gateway          # 启动消息网关（Telegram/Discord/Slack 等）
bitidea gateway setup    # 配置消息网关
bitidea update           # 更新到最新版本
bitidea doctor           # 诊断问题
```

---

## 7. 可选组件安装

根据你的使用场景，可以安装额外组件：

### 消息网关（Telegram / Discord / Slack）

```powershell
pip install -e ".[messaging]"
```

配置完 `.env` 中的 Bot Token 后启动：

```powershell
bitidea gateway setup    # 配置网关
bitidea gateway          # 启动网关
```

### 语音模式

```powershell
pip install -e ".[voice]"
```

### MCP 协议支持

```powershell
pip install -e ".[mcp]"
```

### 定时任务（Cron）

```powershell
pip install -e ".[cron]"
```

### 浏览器工具

需要 Node.js，在项目目录下运行：

```powershell
npm install
```

还需要在 `.env` 中配置 Browserbase API Key。

### 全部安装

```powershell
pip install -e ".[all]"
```

---

## 8. 目录结构说明

### 安装目录

```
%LOCALAPPDATA%\bitidea\
├── bitidea-agent\          # 代码仓库
│   └── venv\               # Python 虚拟环境
│       └── Scripts\
│           └── bitidea.exe  # CLI 入口
├── .env                     # API Key 和环境变量
├── config.yaml              # 主配置文件
├── SOUL.md                  # Agent 人格自定义
├── cron\                    # 定时任务配置
├── sessions\                # 会话存储
├── logs\                    # 日志文件
├── memories\                # Agent 记忆
├── skills\                  # 技能文件
├── hooks\                   # 事件钩子
├── image_cache\             # 图片缓存
├── audio_cache\             # 音频缓存
└── whatsapp\                # WhatsApp 会话
```

### 环境变量

| 变量 | 值 | 说明 |
|------|-----|------|
| `BITIDEA_HOME` | `%LOCALAPPDATA%\bitidea` | 配置和数据目录 |
| `PATH` | 包含 `...\venv\Scripts` | CLI 命令入口 |

---

## 9. 常见问题排查

### Q: `bitidea` 命令找不到

```powershell
# 1. 重启终端
# 2. 检查 PATH 是否包含安装路径
echo $env:Path

# 3. 手动添加路径
$bitideaBin = "$env:LOCALAPPDATA\bitidea\bitidea-agent\venv\Scripts"
[Environment]::SetEnvironmentVariable("Path", "$bitideaBin;$([Environment]::GetEnvironmentVariable('Path', 'User'))", "User")
```

### Q: PowerShell 执行策略阻止脚本运行

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q: Git clone 失败（"copy-fd: write returned: Invalid argument"）

这是 Windows 上常见的 Git 兼容性问题（防病毒软件、OneDrive 或 NTFS 过滤驱动导致）。

```powershell
# 全局修复
git config --global windows.appendAtomically false
```

安装脚本已自动处理此问题。如果仍然失败，安装器会自动改用 ZIP 下载方式。

### Q: pip install 报编译错误

确保安装的是 Python 3.11（推荐）。部分依赖在 Python 3.13+ 上可能缺少预编译 wheel。

```powershell
# 检查 Python 版本
python --version

# 如果版本不对，使用 uv 管理
uv python install 3.11
```

### Q: Node.js 相关工具不工作

```powershell
# 检查 Node.js 是否安装
node --version

# 如果未安装
winget install OpenJS.NodeJS.LTS

# 在项目目录安装 npm 依赖
cd $env:LOCALAPPDATA\bitidea\bitidea-agent
npm install
```

### Q: 诊断所有问题

```powershell
bitidea doctor
```

此命令会检查所有依赖、配置和连接状态。

---

## 10. 卸载

### 删除安装目录

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\bitidea"
```

### 清理环境变量

```powershell
# 移除 BITIDEA_HOME
[Environment]::SetEnvironmentVariable("BITIDEA_HOME", $null, "User")

# 从 PATH 中移除（手动编辑）
# 打开 系统属性 > 高级 > 环境变量 > 用户变量 > Path
# 删除包含 "bitidea" 的条目
```

### 清理 uv（如果不再需要）

```powershell
# uv 安装在 ~/.local/bin/，可以直接删除
Remove-Item "$env:USERPROFILE\.local\bin\uv.exe" -ErrorAction SilentlyContinue
```

---

## 附录：Docker 方式运行（替代方案）

如果不想在 Windows 上直接安装，也可以用 Docker：

```powershell
# 构建镜像
docker build -t bitidea-agent .

# 运行（挂载 .env 配置）
docker run -it --env-file .env bitidea-agent
```

---

> **获取帮助：** 如果遇到本文档未覆盖的问题，运行 `bitidea doctor` 进行诊断，或访问 [GitHub Issues](https://github.com/sabrinaberger083-sys/bitidea-agent/issues) 提交问题。
