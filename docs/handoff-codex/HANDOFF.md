# Bitidea Desktop UI Restyle — Codex 移交文档

## 项目概述

将 Bitidea Desktop（Tauri 2 + React + TypeScript）从"黑客终端"风格重新设计为 **G.TAKE 参考图风格**的高级渐变玻璃态仪表盘。

**目标风格关键词：** 大气渐变背景、超高透明度玻璃面板、渐变边框、渐变文字、浮动深度层次感。

## 当前状态

### 已完成的工作

**Phase 1 已完成** — 27 个文件已修改（189 行新增 / 183 行删除），TypeScript 零编译错误。

| 变更类型 | 状态 | 详情 |
|---------|------|------|
| 字体加载 | ✅ | `index.html` 添加 Google Fonts（Inter + Noto Sans SC） |
| Design Tokens | ✅ | `tokens.css` 全面更新（颜色、圆角、字体、渐变、光效） |
| 大气背景 | ✅ | `.bg-layer` 改为多层径向渐变，`.bg-grid` 改为星点效果 |
| globals.css | ✅ | 按钮、徽章、输入框、标签等全部更新 |
| 聊天组件 | ✅ | ChatWindow、Sidebar、Message、InputBox 四个 CSS 文件 |
| 选择器/弹窗 | ✅ | AssistantPicker、ModelPicker、ApprovalModal |
| 工具/步骤组件 | ✅ | ToolCard、ThinkingBlock、StepIndicator、StatusLine、MessageList |
| 设置/其他 | ✅ | SettingsPanel、AssistantEditor、Logo、FolderList 等 10 个文件 |

### 用户反馈：效果不满意

用户看到当前效果后认为**不够接近 G.TAKE 参考图**。主要问题：
1. **背景渐变太弱** — 虽然已增强（蓝色 0.35 不透明度），但在 app 中看起来还是偏暗偏平
2. **面板透明度不够明显** — 虽然降到 0.18-0.20，但因背景本身暗导致视觉差异不大
3. **缺少渐变边框** — `--border-glow` token 已定义但未实际应用到组件
4. **缺少渐变文字** — Logo 已有（`var(--grad-title)`），但其他标题未添加

## 需要继续的工作

### 优先级 1：视觉效果显著增强

1. **背景渐变大幅增强**
   - `tokens.css` 的 `.bg-layer` 渐变不够醒目
   - 参考值：顶部蓝光 opacity 建议 0.4-0.5，紫光 0.25+
   - 考虑添加更多渐变层（如中间层暖色微光）
   - 底部山峦轮廓效果要更明显

2. **渐变边框实际应用**
   - Token `--border-glow` 已定义但未使用
   - 需要用 `::before` 伪元素实现（因 `border-image` 不兼容 `border-radius`）
   - 关键组件需要渐变边框：sidebar、topbar、input-bar、tool-card、think-card
   - 实现方式参考：
   ```css
   .component {
     position: relative;
   }
   .component::before {
     content: '';
     position: absolute;
     inset: 0;
     border-radius: inherit;
     padding: 1px;
     background: var(--border-glow);
     -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
     mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
     -webkit-mask-composite: xor;
     mask-composite: exclude;
     pointer-events: none;
   }
   ```

3. **渐变文字扩展应用**
   - Logo 已有渐变文字，需扩展到：
     - `.ml-empty-title`（空状态标题）
     - `.sidebar-bucket-label`（时间分组标签）
     - `.ae-title`（助手编辑器标题）
     - 其他主要标题

4. **面板内发光效果**
   - 添加 `box-shadow: inset 0 0 12px rgba(74,158,255,0.08)` 给玻璃面板
   - 增强浮动感

### 优先级 2：细节打磨

5. **阴影优化** — 浮动元素使用漫射阴影：`0 20px 40px rgba(0,0,0,0.4), 0 0 20px rgba(74,158,255,0.05)`
6. **hover 效果增强** — hover 时增加 backdrop-blur 和内发光
7. **按钮渐变** — `.btn-primary` 改为渐变背景 + 外发光
8. **滚动条** — 更细更透明

## 设计参考

### G.TAKE 目标风格核心特征

```
背景：深蓝底色(#0A1028) + 多层大气渐变光晕 + 底部山峦轮廓 + 星点
面板：rgba(15,25,50, 0.18) + backdrop-filter: blur(16-20px)
边框：1px 渐变边框（135° 从左上蓝到右下透明）
文字：标题用渐变（白→蓝→天蓝），正文 #F1F5F9，次要 #94A3B8
圆角：面板 14-16px，内部组件 6-10px
光效：柔和漫射光晕，无霓虹/赛博感
```

### Stitch 设计系统参考：Celestial Aether

Stitch 生成的设计系统文档在 `design-system-celestial-aether.md`（同目录），包含完整的颜色 token、排版规则、组件规范。核心原则：
- **No-Line Rule** — 禁止 1px 实线分割，用背景色差 + 间距分区
- **Glass & Gradient Signature** — 所有浮动面板用渐变边框 + 内发光
- **Surface Hierarchy** — Level 0（大气背景）→ Level 1（玻璃面板 18% 不透明度）→ Level 2（焦点容器 25%）

## 技术架构

### 项目结构（仅 CSS 相关）

```
src/
├── styles/
│   ├── tokens.css          ← 设计 token 源头（所有 CSS 变量定义）
│   └── globals.css          ← 全局组件样式（按钮、输入框、标签等）
├── components/
│   ├── Chat/
│   │   ├── ChatWindow.css   ← 主窗口布局（topbar、body）
│   │   ├── ConversationSidebar.css ← 侧边栏（260px，对话列表）
│   │   ├── Message.css      ← 消息气泡
│   │   ├── InputBox.css     ← 底部输入区
│   │   ├── AssistantPicker.css
│   │   ├── ModelPicker.css
│   │   ├── ApprovalModal.css
│   │   ├── ToolCard.css
│   │   ├── ThinkingBlock.css
│   │   ├── StepIndicator.css
│   │   ├── StatusLine.css
│   │   ├── MessageList.css
│   │   ├── ProjectPicker.css
│   │   ├── KnowledgePanel.css
│   │   ├── FolderList.css
│   │   ├── UndoToast.css
│   │   ├── ArtifactPreview.css
│   │   └── MarkdownEditor.css
│   ├── Settings/
│   │   ├── SettingsPanel.css
│   │   └── AssistantEditor.css
│   ├── common/
│   │   ├── Logo.css
│   │   └── BackgroundEffects.tsx  ← 渲染 .bg-layer + .bg-grid
│   └── Onboarding/
│       └── Onboarding.css
└── index.html               ← Google Fonts 加载
```

### 关键设计 Token（当前值）

```css
--bg: #0A1028;
--panel: rgba(15, 25, 50, 0.18);
--panel-solid: #111B2E;
--panel-border: rgba(120, 180, 255, 0.10);
--accent: #4A9EFF;
--accent-2: #7DD3FC;
--accent-3: #A78BFA;
--border-glow: linear-gradient(135deg, rgba(74,158,255,0.3) 0%, rgba(125,211,252,0.08) 100%);
--grad-title: linear-gradient(135deg, #F8FAFC 0%, #4A9EFF 50%, #7DD3FC 100%);
--font-sans: 'Inter', 'Noto Sans SC', ...;
--r-md: 10px; --r-lg: 14px; --r-xl: 16px;
```

### 背景层结构

```tsx
// src/components/common/BackgroundEffects.tsx
<div className="bg-layer" aria-hidden />  // z-index: -2, 大气渐变
<div className="bg-grid" aria-hidden />   // z-index: -1, 星点效果
```

## Git 信息

- **当前分支：** `feat/agent-integration`
- **备份分支：** `pre-restyle-backup`（commit `cb10cf8`）—— 完整原始状态
- **复原方式：** `git checkout pre-restyle-backup` 或 `git stash && git checkout pre-restyle-backup`
- **完整 diff 文件：** `docs/handoff-codex/full-diff.patch`

## 启动与验证

```bash
# 启动 macOS 桌面 app
npx tauri dev

# 仅启动前端（浏览器预览）
npm run dev   # → http://localhost:1420

# TypeScript 检查
npx tsc --noEmit

# 当前状态：零编译错误
```

## 用户偏好

- **语言：** 中文交流
- **审美方向：** G.TAKE 风格 — 高级渐变、玻璃态、大气深度
- **底线：** 不满意可以用 `pre-restyle-backup` 分支完全复原
- **约束：** 纯 CSS 改动，不修改组件布局或功能逻辑
