# Design System: Celestial Aether

> Stitch 生成的设计系统规范，基于 G.TAKE 参考图分析

## 1. Creative North Star: Celestial Intelligence

UI 不是"放在"背景上，而是"浮在"大气环境中。通过超高透明度、重度背景模糊和有机光泄漏创造无限深度感。用户感觉像透过高科技观测镜头看到数据的广袤。

## 2. 颜色 & 大气表面管理

### 调色板
- **Background Base:** `#0A1028`（深蓝底色，比纯黑更有氛围）
- **Primary (Action):** `#4A9EFF` | container: `#a4c9ff`
- **Secondary (Atmosphere):** `#7DD3FC`（柔和天蓝，替代原来的霓虹青 #00e5ff）
- **Tertiary:** `#A78BFA` / `#C4B5FD`（紫色系）
- **Surface 层级:** `#0a0e1a`（最低）→ `#303442`（最高）

### No-Line Rule（无线条规则）
禁止使用 1px solid border 做分区。结构分割只能用：
1. 背景色差（surface_container 层级切换）
2. 色调过渡（backdrop-blur 强度变化）
3. 负空间（间距）

### 表面层级
- **Level 0 (Atmosphere):** 基底背景 + 山峦轮廓 + 星点
- **Level 1 (The Glass):** 大面板 `rgba(15, 25, 50, 0.18)` + `backdrop-filter: blur(20px)`
- **Level 2 (The Focus):** 嵌套容器 25% 不透明度，"抬升"到用户面前

### Glass & Gradient 签名效果
每个浮动面板：
- **渐变边框：** 135° 方向，从 `rgba(74,158,255,0.3)` 到 `rgba(125,211,252,0.08)`
- **内发光：** `box-shadow: inset 0 0 12px rgba(74,158,255,0.1)`
- **实现方式：** 用 `::before` 伪元素 + mask-composite 技巧

## 3. 排版

使用 **Inter** 字体，等宽字体仅用于代码。

- **Display/Headlines:** 使用签名渐变 — 白(#F1F5F9) → 蓝(#4A9EFF) → 天蓝(#7DD3FC)
- **Body:** `body-md` #F1F5F9
- **Secondary:** `label-md` #94A3B8
- **对比规则：** 标题和正文之间保持大的尺寸差距

## 4. 深度 & 阴影

- **漫射阴影：** `box-shadow: 0 20px 40px rgba(0,0,0,0.4), 0 0 20px rgba(74,158,255,0.05)`
- **Ghost Border：** 如果必须用分割线，用 `outline_variant` 15% 不透明度
- **圆角：** 主面板 `1.5rem (24px)`，内部组件 `1rem (16px)`

## 5. 组件规范

### 按钮
- **Primary:** `primary` → `primary_container` 渐变。白色文字。无阴影 → 用 4px 外发光
- **Secondary (Glass):** 半透明背景 + 1px 渐变边框。Hover 增加 blur 和内发光

### 输入框
- `surface_container_lowest` 40% 不透明度
- Focus 时渐变边框动画 + 内发光增强到 `rgba(74,158,255,0.3)`

### 卡片 & 列表
- 无分割线。列表项间 24-32px 垂直间距
- 选中态：背景色切换到 `surface_container_highest` + 左侧 2px 光条

## 6. Do's and Don'ts

### Do:
- 让背景光晕影响布局 — 把关键指标放在光晕上方让它们"弹出"
- 优先排版而非图标 — 用文字承载品牌高级感

### Don't:
- 不用纯黑 #000 做容器背景（破坏玻璃效果）
- 不用高强度"游戏风"霓虹（保持优雅低饱和）
- 不用 0 blur 的标准投影（这是大气系统，光线始终漫射）
- 不堆叠 — 如果界面感觉拥挤，增加透明度和间距

## 7. 关键 CSS Token 速查

```css
/* 背景 */
--bg: #0A1028;
--panel: rgba(15, 25, 50, 0.18);

/* 颜色 */
--accent: #4A9EFF;
--accent-2: #7DD3FC;
--accent-3: #A78BFA;

/* 渐变 */
--border-glow: linear-gradient(135deg, rgba(74,158,255,0.3), rgba(125,211,252,0.08));
--grad-title: linear-gradient(135deg, #F8FAFC, #4A9EFF, #7DD3FC);

/* 圆角 */
--r-md: 10px; --r-lg: 14px; --r-xl: 16px;

/* 字体 */
--font-sans: 'Inter', 'Noto Sans SC', ...;

/* 效果 */
--glow: 0 4px 24px rgba(74,158,255,0.12), 0 12px 48px rgba(74,158,255,0.06);
```
