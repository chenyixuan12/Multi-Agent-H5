# Travel Agents

这是旅行规划的独立 Agent 进程集合。每个 Agent 使用一个 Node.js 进程和一个 HTTP 端口，默认端口如下：

| Agent | 端口 | 职责 |
| --- | ---: | --- |
| requirements | 3401 | 需求分析 |
| route | 3402 | 路线规划 |
| spots | 3403 | 景点筛选 |
| budget | 3404 | 预算评估 |
| synthesis | 3405 | 行程整合 |

## 启动

在项目根目录执行：

```powershell
npm run dev:all
```

也可以单独启动一个 Agent：

```powershell
npm --prefix travel-agents run start -- requirements 3401
```

Agent 默认读取 `travel-server/.env`。生产环境建议为每个进程指定独立配置文件：

```powershell
$env:AGENT_ENV_FILE = 'D:\config\requirements.env'
$env:AGENT_NAME = 'requirements'
npm --prefix travel-agents run start -- requirements 3401
```

所有 Agent 可以共享同一个模型配置。若需要按 Agent 选择模型，在环境变量中设置 `REQUIREMENTS_MODEL`、`ROUTE_MODEL`、`SPOTS_MODEL`、`BUDGET_MODEL` 或 `SYNTHESIS_MODEL`；API Key 和 Base URL 仍可共享。

Agent 默认关闭 Qwen 思考模式，并且主服务默认不重试超时请求，避免一次规划重复等待。需要调整时可设置 `AGENT_ENABLE_THINKING=true`、`AGENT_TIMEOUT_MS=60000` 或 `AGENT_RETRIES=1`。

## HTTP 协议

健康检查：

```text
GET http://127.0.0.1:3401/health
```

执行请求：

```json
{
  "traceId": "trace-001",
  "taskId": "task-001",
  "input": {}
}
```

主服务通过 `travel-server/src/contracts/agentContract.js` 调用这些端口，包含超时、重试和 traceId 透传。

推荐流程采用依赖感知的并发：需求分析先执行；路线规划和景点筛选并行执行；预算评估等待两者完成；最后由行程整合 Agent 汇总。这样保留数据依赖的同时减少一轮模型等待。

## 工具型 Agent（ReAct 循环）

`budget`（预算评估）和 `synthesis`（行程整合）是工具型 Agent：它们通过 `travel-server` 的 `travelAgentTools.js` 绑定实时数据工具，并在每次请求中运行轻量 ReAct 循环——模型返回 `tool_call` 时执行对应工具、把结果作为 `ToolMessage` 放回上下文继续推理，直到模型输出最终答案或达到最大迭代次数。

可用工具按 Agent 划分：

| Agent | 工具 |
| --- | --- |
| budget | `get_weather`、`search_spots`、`verify_spot`、`validate_budget` |
| synthesis | `get_weather`、`search_spots`、`verify_spot`、`validate_budget`、`validate_plan` |

工具调用基于高德 API 与本地校验规则，无需额外服务。相关配置：

- `AGENT_TOOL_MAX_ITERATIONS`：单次请求最大模型调用轮数（默认 5）
- `AMAP_API_KEY`：高德 Key，未配置时工具返回空结果，Agent 回退到输入上下文数据

## 验证

```powershell
Invoke-RestMethod http://127.0.0.1:3401/health
npm --prefix travel-server test
npm --prefix travel-agents test
npm run build:client
```
