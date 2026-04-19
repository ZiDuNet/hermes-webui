# hermes-web-unified

基于 [hermes-webui](../hermes-webui) 扩展的统一 Web UI，保持 Vanilla JS + Flask 架构。

## 新增功能

在原有 hermes-webui 功能基础上，新增以下管理面板（侧边栏可切换）：

### Config 管理 (`config-panel.js`)
- 分类导航（general, agent, terminal, display 等 15 个分类）
- 自动字段渲染（boolean → 开关, select → 下拉, string → 输入框）
- YAML 原始编辑模式
- 搜索、导入/导出 JSON、重置为默认值
- Dirty 追踪 + 保存前备份 config.yaml.bak

### Keys / Env 管理 (`keys-panel.js`)
- 116 个环境变量，按 Provider 分组（OpenAI, Anthropic, Google 等 18 组）
- 搜索、脱敏显示、Reveal（速率限制 5次/30秒）
- 设置、编辑、删除
- Advanced 切换（显示/隐藏高级变量）
- 未设置变量折叠显示

### MCP Servers 管理 (`mcp-panel.js`)
- 服务器列表（卡片式展示）
- 添加/编辑表单（stdio/sse/streamable-http）
- 启用/禁用开关
- 删除确认

### Gateway 管理 (`gateway-panel.js`)
- 状态检测（PID + health endpoint）
- 平台连接状态展示
- 启动/停止/重启（调用 `hermes gateway` CLI）
- 自动刷新

### Logs 查看 (`logs-panel.js`)
- 读取 agent.log / gateway.log
- 日志级别过滤（ERROR/WARNING/INFO/DEBUG）
- 关键词搜索
- 自动刷新（5秒间隔）
- ERROR/WARNING 高亮

### Usage 统计 (`usage-panel.js`)
- 汇总卡片（Sessions, Input/Output tokens, Est. cost）
- 按模型分组统计
- 每日趋势图（最近 14 天柱状图）
- 时间范围选择（7d/30d/90d）

### 渠道管理 (`channels-panel.js`)
- 8 平台支持：Telegram、Discord、Slack、WhatsApp、Matrix、飞书、钉钉、企微
- 卡片式展示，显示配置状态
- 每平台独立配置表单（Token/Secret/Channel 等）
- 凭据保存到 .env，配置保存到 config.yaml

### OAuth / API Key 管理 (`oauth-panel.js`)
- 7 Provider：Anthropic、OpenAI、Google、Groq、Mistral、DeepSeek、OpenRouter
- 显示设置状态（已设置/未设置）
- 设置/显示/删除 API Key
- 通过 env reveal 获取真实值（限速保护）

### Terminal 终端 (`terminal-panel.js`)
- HTTP polling 模式命令执行
- 命令输入 + 回车执行
- 安全过滤（阻止危险命令）
- 30 秒超时保护
- 输出高亮（命令/错误/信息）

## 后端 API

所有新增 API 在 `api/mgmt_routes.py`，路径前缀 `/api/mgmt/`：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/mgmt/config` | GET | 读取归一化的 config |
| `/api/mgmt/config` | POST | 保存 config |
| `/api/mgmt/config/defaults` | GET | DEFAULT_CONFIG |
| `/api/mgmt/config/schema` | GET | 字段 schema + 分类排序 |
| `/api/mgmt/config/raw` | GET/POST | 原始 YAML 读写 |
| `/api/mgmt/config/reset` | POST | 重置为默认值 |
| `/api/mgmt/env` | GET | 列出所有 env var（脱敏） |
| `/api/mgmt/env` | POST | 设置 env var |
| `/api/mgmt/env/delete` | POST | 删除 env var |
| `/api/mgmt/env/reveal` | POST | 揭示真实值（限速） |
| `/api/mgmt/mcp-servers` | GET | 列出 MCP 服务器 |
| `/api/mgmt/mcp-servers/add` | POST | 添加 |
| `/api/mgmt/mcp-servers/update` | POST | 更新 |
| `/api/mgmt/mcp-servers/delete` | POST | 删除 |
| `/api/mgmt/gateway/status` | GET | 网关状态 |
| `/api/mgmt/gateway/start` | POST | 启动 |
| `/api/mgmt/gateway/stop` | POST | 停止 |
| `/api/mgmt/gateway/restart` | POST | 重启 |
| `/api/mgmt/logs` | GET | 日志读取 |
| `/api/mgmt/usage` | GET | 用量统计 |
| `/api/mgmt/channels` | GET | 渠道列表（8 平台） |
| `/api/mgmt/channels` | POST | 保存渠道配置+凭据 |
| `/api/mgmt/oauth/providers` | GET | OAuth Provider 列表 |
| `/api/mgmt/oauth/set-key` | POST | 设置 API Key |
| `/api/mgmt/oauth/remove-key` | POST | 删除 API Key |
| `/api/mgmt/terminal/exec` | POST | 执行终端命令 |

**关键优势**：直接 `from hermes_cli.config import DEFAULT_CONFIG, load_config, save_config` 等，不需要 Gateway API，不需要内联数据文件。

## 文件结构

```
hermes-web-unified/
├── api/
│   ├── mgmt_routes.py     # 新增：所有管理 API 路由
│   ├── routes.py           # 修改：注册 mgmt 路由
│   └── ...                 # 原有文件不变
├── static/
│   ├── config-panel.js     # 新增：Config 面板
│   ├── keys-panel.js       # 新增：Keys 面板
│   ├── mcp-panel.js        # 新增：MCP Servers 面板
│   ├── gateway-panel.js    # 新增：Gateway 面板
│   ├── logs-panel.js       # 新增：Logs 面板
│   ├── usage-panel.js      # 新增：Usage 面板
│   ├── channels-panel.js   # 新增：Channels 渠道管理面板
│   ├── oauth-panel.js      # 新增：OAuth/API Key 管理面板
│   ├── terminal-panel.js   # 新增：Terminal 终端面板
│   ├── index.html          # 修改：添加面板 HTML
│   ├── panels.js           # 修改：switchPanel 懒加载
│   ├── style.css           # 修改：添加面板样式
│   └── ...                 # 原有文件不变
├── server.py               # 不变
└── ...
```
