<div align="center">

<img src="src/assets/pi-my-logo.png" alt="Pi-My" width="96" />

# Pi-My

**Pi 编程助手的桌面客户端**

一个干净、克制、可换肤的图形界面，套在 [Pi Coding Agent](https://github.com/earendil-works/pi) 之上。

[![Release](https://img.shields.io/github/v/release/TANGZZee/pi-my?color=171717&label=release)](https://github.com/TANGZZee/pi-my/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2-171717)](https://tauri.app)
[![Svelte](https://img.shields.io/badge/Svelte-5-171717)](https://svelte.dev)

</div>

---

## ✨ 特性

### 🎨 皮肤系统
不止浅色 / 深色。整套 **CSS 设计令牌**，5 套皮肤一键切换，深色模式保留主色强调：

| 皮肤 | 风格 |
|------|------|
| 石墨 | 出厂灰阶，干净克制 |
| 苔原 | 纸感浅绿 + 鼠尾草主色 |
| 海雾 | 冷灰蓝 + 靛蓝强调 |
| 宣纸 | 暖米色 + 琥珀强调 |
| 夜墨 | 高对比深色墨底 |

### 🖥️ 原生桌面体验
- **无边框窗口**：自定义标题栏 + 最小化 / 最大化 / 关闭 + 拖拽
- 三栏布局：会话列表 · 对话区 · 工作区，左右栏可折叠、可拖拽调整宽度

### 🤖 完整的 Agent 工作流
- 多会话标签页，会话归档 / 置顶 / 分叉 / 导出 / 复制链接
- 权限模式（只读 / 默认 / 完全）+ 工具调用确认桥
- 思考深度滑块、模型搜索下拉、上下文用量环
- 子代理并行拆分（/scout 或自定义 agent）
- `@` 引用文件、`/` 斜杠命令、附件（图片走视觉桥）

### 🧰 工作区工具箱
- **文件树**：预览 / 编辑工作区文件
- **Git 面板**：查看变更、暂存、提交、推送
- **内置终端**：cmd / PowerShell
- **待办**：任务清单 + 子任务，`/todo` 写入

### 🛍️ 商店 / 生态
- **prompts.chat**：精选提示词（按投票 / 浏览排序）
- **pi 官方插件库**：pi.dev/packages（`keywords:pi-package`），按下载量排名
- **skills.sh**：按安装量排名的技能
- **中文精选**：内置常用提示词
- 一键导入提示词 / 安装 Skill / 安装插件 / 卸载

### 🔐 应用内登录与装插件
OAuth 设备码登录（Anthropic / OpenAI Codex）与 `pi install` 全部走**内嵌 SDK**，
**无需安装全局 `pi` CLI**。

### 📊 用量统计
按模型 / 项目 / 日期维度的 Token 统计、费用估算、近 12 周活跃热力图。

### 🌐 更多
- 局域网只读观察（手机同 Wi-Fi 看会话进度，带二维码）
- 桌面通知（任务完成 / 需要确认）
- 桌宠、生图模式、视觉桥、Sidecar 日志查看

---

## 📦 安装

从 [Releases](https://github.com/TANGZZee/pi-my/releases) 下载 Windows 安装包：

| 文件 | 说明 |
|------|------|
| `Pi-My_0.1.0_x64-setup.exe` | NSIS 安装器（推荐） |
| `Pi-My_0.1.0_x64_en-US.msi` | MSI 安装包 |

> 需要系统已安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 10/11 通常自带）。

---

## 🛠️ 开发

### 环境要求

- [Node.js](https://nodejs.org) ≥ 20
- [Rust](https://rustup.rs)（stable toolchain）
- [Tauri 2](https://tauri.app) 所需系统依赖（Windows：MSVC Build Tools + WebView2）

### 命令

```bash
# 安装依赖
npm install

# 启动开发（热更新，仅前端）
npm run dev

# 启动完整桌面应用（开发模式）
npm run tauri dev

# 打包发布（生成 MSI + NSIS 安装器）
npm run tauri build
```

### 目录结构

```
├── src/                    # Svelte 前端
│   ├── App.svelte          # 主界面
│   ├── Settings.svelte     # 设置面板
│   ├── ConfigPane.svelte   # 配置管理（模型 / 认证 / 源文件）
│   ├── skins.ts            # 皮肤色板
│   └── ...
├── sidecar/                # Node sidecar（内嵌 Pi SDK）
│   ├── index.mjs           # 协议入口
│   ├── config.mjs          # 模型 / 认证 / 代理
│   ├── ecosystem.mjs       # 商店 / 生态
│   └── lan.mjs             # 局域网观察
└── src-tauri/              # Tauri / Rust 后端
```

---

## 🧱 技术栈

- **Tauri 2** — 轻量桌面壳
- **Svelte 5** — 响应式 UI
- **Pi Coding Agent SDK** — 内嵌的 Agent 运行时（`@earendil-works/pi-coding-agent`）
- **xterm.js** — 内置终端
- **portable-pty** — PTY 后端
