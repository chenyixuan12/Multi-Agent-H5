# Travel Agent

基于 Vue 3、Node.js、LangChain 和多 Agent 协作的智能旅行规划应用。用户输入出发地、目的地、预算和天数后，系统会结合天气、景点 POI、铁路票务等数据，生成可执行的每日行程、交通建议和预算明细。

## 功能

- 旅行规划：根据出发地、目的地、预算和天数生成行程。
- 多 Agent 协作：需求分析、路线规划、景点筛选、预算评估、地标候选和行程整合。
- 实时数据：可接入高德地图天气与景点数据，以及 12306 MCP 车次查询服务。
- 流式响应：通过 SSE 实时返回规划阶段、实时数据、行程字段和最终结果。
- 行程管理：支持查看行程详情、历史记录、收藏、方案和个人设置。
- AI 对话：提供独立的流式旅行咨询接口。
- 预算校验：对城际交通、市内交通、住宿、餐饮、门票和其他支出进行核算。

## 项目结构

```text
.
├── travel-h5/       Vue 3 + Vite 移动端前端
├── travel-server/   Express API 服务和旅行规划编排器
├── travel-agents/   独立 Agent HTTP 进程集合
├── 12306-mcp/       12306 车票查询 MCP 服务
├── package.json      根目录启动和构建脚本
└── README.md
```

请求链路大致如下：

```text
Vue H5
  -> travel-server
      -> travelDataService（天气、景点、地理编码）
      -> railway12306Service -> 12306-mcp
      -> travel-agents（需求、路线、景点、预算、整合）
```

## 环境要求

- Node.js 18 或更高版本
- npm
- 可选：高德 Web 服务 API Key
- 可选：OpenAI 兼容的大模型 API 配置
- 可选：12306 MCP 服务，用于实时车次查询

## 安装

在项目根目录执行：

```powershell
npm install
npm --prefix travel-server install
npm --prefix travel-agents install
npm --prefix travel-h5 install
npm --prefix 12306-mcp install
```

## 环境变量

在 `travel-server/.env` 中配置服务端参数。建议从以下配置开始，再替换为自己的密钥和模型：

```dotenv
PORT=3300

# 模型提供商：aliyun 或 deepseek
MODEL_PROVIDER=aliyun
ALIYUN_API_KEY=your_api_key
ALIYUN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_MODEL=your_model

# MODEL_PROVIDER=deepseek 时使用以下配置
LLM_API_KEY=your_api_key
LLM_API_BASE=https://api.deepseek.com/v1
LLM_MODEL=your_model

# 可选：高德天气、景点和地理服务
AMAP_API_KEY=your_amap_key

# 可选：12306 MCP Streamable HTTP 服务
RAILWAY_12306_ENABLED=true
RAILWAY_MCP_URL=http://127.0.0.1:8124/mcp
RAILWAY_12306_TIMEOUT=25000

# Agent 模型可单独覆盖；未设置时使用共享模型配置
REQUIREMENTS_MODEL=your_model
ROUTE_MODEL=your_model
SPOTS_MODEL=your_model
BUDGET_MODEL=your_model
SYNTHESIS_MODEL=your_model
CANDIDATES_MODEL=your_model

LLM_MAX_TOKENS=4096
SYNTHESIS_MAX_TOKENS=8192
LLM_ENABLE_THINKING=false
AGENT_ENABLE_THINKING=false
AGENT_RETRIES=0
AGENT_TEMPERATURE=0.2
AUTO_REPLAN=true
POST_VALIDATE=false
```

不要将真实 API Key 提交到 Git。`travel-server/.env` 仅用于本地运行。

## 启动

### 前端和主服务

```powershell
npm run dev
```

默认地址：

- 前端：Vite 输出的本地地址，通常为 `http://localhost:5173`
- API 服务：`http://localhost:3300`

### 完整本地环境

需要使用独立 Agent 和 12306 MCP 时执行：

```powershell
npm run dev:all
```

该命令会启动：

| 服务 | 默认端口 | 说明 |
| --- | ---: | --- |
| 12306 MCP | 8124 | 铁路车次查询 |
| travel-server | 3300 | 主 API 服务 |
| travel-h5 | 5173 | Vue 前端 |
| requirements Agent | 3401 | 需求分析 |
| route Agent | 3402 | 路线规划 |
| spots Agent | 3403 | 景点筛选 |
| budget Agent | 3404 | 预算评估 |
| synthesis Agent | 3405 | 行程整合 |
| candidates Agent | 3406 | 地标候选 |

也可以单独启动：

```powershell
npm run dev:client
npm run dev:server
npm run dev:mcp
npm --prefix travel-agents run start -- requirements 3401
```

独立 Agent 的详细协议和配置说明见 [travel-agents/README.md](./travel-agents/README.md)。12306 MCP 的使用方式见 [12306-mcp/README.md](./12306-mcp/README.md)。

## API

主服务前缀为 `/api/travel`，规划和对话接口均使用 SSE 流式响应。

### 生成旅行规划

```http
POST /api/travel/recommend
Content-Type: application/json
Accept: text/event-stream
```

请求示例：

```json
{
  "origin": "北京",
  "city": "西安",
  "budget": 3000,
  "days": 3
}
```

流事件包括 `stage`、`data_context`、`agent_context`、`timing`、`validation`、`complete` 和 `error` 等类型。

### AI 对话

```http
POST /api/travel/chat
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "message": "帮我规划一个三天的西安旅行"
}
```

### 心跳检查

```http
POST /api/heartbeat
Content-Type: application/json
```

## 构建与测试

```powershell
# 构建前端
npm run build:client

# 构建 12306 MCP
npm run build:mcp

# 主服务测试
npm --prefix travel-server test

# Agent 测试
npm --prefix travel-agents test
```

启动 Agent 后，可检查健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:3401/health
```

## 常见问题

### 规划请求失败

确认 `travel-server/.env` 中已配置与 `MODEL_PROVIDER` 对应的 API Key、Base URL 和模型名称，并检查主服务日志。

### 没有车次数据

确认 12306 MCP 已启动、`RAILWAY_MCP_URL` 与 MCP 端口一致，并检查 `RAILWAY_12306_ENABLED` 是否为 `true`。没有铁路数据时，系统仍可基于其他实时上下文和本地规则生成规划，但不会伪造车次信息。

### Agent 请求超时

确认 3401-3406 端口未被占用。也可以先只运行主服务和前端；主服务会在独立 Agent 不可用时按配置使用降级逻辑。

## 许可证与说明

本项目用于学习和实践智能旅行规划、多 Agent 编排、SSE 流式响应及 MCP 集成。天气、景点、票务和价格信息可能发生变化，实际出行前请以官方渠道和现场信息为准。
