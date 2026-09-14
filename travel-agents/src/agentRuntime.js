import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { createTravelTools } from '../../travel-server/src/service/travelAgentTools.js'
import { AGENT_DEFINITIONS } from './agentDefinitions.js'

// 只有工具型 Agent 才绑定工具并启用 ReAct 循环；纯文本 Agent 保持一次调用。
const TOOL_AGENTS = ['budget', 'synthesis']

// 各工具型 Agent 可用的工具集合：budget 负责预算评估，synthesis 负责行程整合。
const TOOL_NAMES = {
  budget: ['get_weather', 'search_spots', 'verify_spot', 'validate_budget'],
  synthesis: ['get_weather', 'search_spots', 'verify_spot', 'validate_budget', 'validate_plan'],
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: process.env.AGENT_ENV_FILE || path.resolve(currentDir, '../../travel-server/.env') })

const extractText = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => typeof part === 'string' ? part : part?.text || part?.content || '').join('')
}

function createLLM() {
  const provider = process.env.AGENT_MODEL_PROVIDER || process.env.MODEL_PROVIDER || 'aliyun'
  const prefix = provider === 'deepseek' ? 'LLM' : 'ALIYUN'
  const apiKey = process.env[`${prefix}_API_KEY`]
  const baseURL = process.env[`${prefix}_API_BASE`]
  const model = process.env[`${process.env.AGENT_NAME?.toUpperCase()}_MODEL`] || process.env.AGENT_MODEL || process.env[`${prefix}_MODEL`]
  if (!apiKey || !baseURL || !model) throw new Error(`Agent 模型配置不完整：${prefix}_API_KEY、${prefix}_API_BASE、模型名`) 
  const agentName = process.env.AGENT_NAME || ''
  // 关键：synthesis Agent 需要真正的 token 级流式输出。阿里云开启了 enable_thinking
  // 时，DashScope 会先把思考内容缓冲完再一次性吐出正文，前端看起来仍是"最后全部出现"。
  // 因此 synthesis 关闭 thinking 并把 streaming 设为 true；思考生成的 agent 保持原样。
  const enableThinking = agentName !== 'synthesis'
    && (process.env.AGENT_ENABLE_THINKING === 'true' || process.env.LLM_ENABLE_THINKING === 'true')
  return new ChatOpenAI({
    configuration: { baseURL },
    apiKey,
    model,
    temperature: Number(process.env.AGENT_TEMPERATURE || 0.3),
    maxTokens: Number(process.env[`${agentName.toUpperCase()}_MAX_TOKENS`] || process.env.AGENT_MAX_TOKENS || (agentName === 'synthesis' ? 8192 : 1600)),
    streaming: agentName === 'synthesis',
    modelKwargs: provider === 'aliyun'
      ? { enable_thinking: enableThinking }
      : {},
  })
}

// 工具型 Agent 的轻量 ReAct 循环：模型返回 tool_call 时执行工具并把结果放回消息，
// 直到模型输出最终答案或达到最大迭代次数。无工具调用（含 tool_calls 为空数组）即结束。
export async function runWithTools({ llm, tools, buildMessages, streamOutput }) {
  const toolMap = new Map(tools.map((item) => [item.name, item]))
  const messages = await buildMessages()
  const maxIterations = Number(process.env.AGENT_TOOL_MAX_ITERATIONS || 5)
  let full = ''

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const response = await llm.invoke(messages, { tools })
    const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : []
    if (!toolCalls.length) {
      full += extractText(response.content)
      break
    }
    messages.push(response)
    for (const call of toolCalls) {
      const tool = toolMap.get(call.name)
      let content
      if (!tool) {
        content = `未知工具：${call.name}`
      } else {
        try {
          content = JSON.stringify(await tool.invoke(call.args ?? {}))
        } catch (error) {
          content = `工具调用失败：${error.message}`
        }
      }
      messages.push(new ToolMessage(content, call.id, call.name))
      streamOutput?.(content)
    }
  }
  return full.trim()
}

export function createAgentServer(agentName, port) {
  const definition = AGENT_DEFINITIONS[agentName]
  if (!definition) throw new Error(`未知 Agent：${agentName}`)
  const llm = createLLM()
  // 工具型 Agent 通过 travel-server 的数据服务执行实时查询（天气、景点、核验、预算校验）。
  const toolAgent = TOOL_AGENTS.includes(agentName)
  const tools = toolAgent ? createTravelTools({ names: TOOL_NAMES[agentName] }) : []
  const sendJson = (res, statusCode, body) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok', agent: agentName, pid: process.pid })
    }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/run') {
      return sendJson(res, 404, { success: false, message: '接口不存在' })
    }
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 512 * 1024) return sendJson(res, 413, { success: false, agent: agentName, message: '请求体超过 512kb' })
      chunks.push(chunk)
    }
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return sendJson(res, 400, { success: false, agent: agentName, message: '请求体必须是 JSON' })
    }
    const startedAt = Date.now()
    const traceId = body?.traceId || req.headers['x-trace-id'] || 'unknown'
    const input = body?.input
    if (!input || typeof input !== 'object') return sendJson(res, 400, { success: false, agent: agentName, message: '缺少 input 对象' })

    const buildMessages = async () => {
      const instruction = typeof definition.instruction === 'function' ? definition.instruction(input) : definition.instruction
      return [
        new SystemMessage(definition.system),
        new HumanMessage(`${instruction}\n\n输入上下文：\n${JSON.stringify(input)}`),
      ]
    }

    const runModel = async () => {
      if (!toolAgent) {
        const response = await llm.invoke(await buildMessages())
        return extractText(response.content).trim()
      }
      return runWithTools({ llm, tools, buildMessages })
    }

    // 客户端请求 SSE 时，模型逐 token 生成并实时转发，供上层边规划边渲染
    const streamRequested = String(req.headers.accept || '').includes('text/event-stream')
      || new URL(req.url, 'http://agent.local').searchParams.get('stream') === '1'
    try {
      if (streamRequested) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        let full = ''
        try {
          if (toolAgent) {
            full = await runWithTools({
              llm,
              tools,
              buildMessages,
              streamOutput: (content) => {
                full += content
                res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`)
              },
            })
          } else {
            const llmStream = await llm.stream(await buildMessages())
            for await (const chunk of llmStream) {
              const text = extractText(chunk.content)
              if (!text) continue
              full += text
              res.write(`data: ${JSON.stringify({ type: 'token', content: text })}\n\n`)
            }
          }
        } catch (error) {
          console.error(`[${agentName}] trace=${traceId} stream failed: ${error.message}`)
          res.write(`data: ${JSON.stringify({ type: 'error', message: `${definition.label} Agent 流式执行失败` })}\n\n`)
          res.end()
          return
        }
        if (!full.trim()) throw new Error('模型返回为空')
        res.write(`data: ${JSON.stringify({
          type: 'done',
          output: full,
          meta: { traceId, pid: process.pid, model: llm.model, duration_ms: Date.now() - startedAt },
        })}\n\n`)
        res.end()
        return
      }

      const response = await runModel()
      const output = extractText(response).trim()
      if (!output) throw new Error('模型返回为空')
      return sendJson(res, 200, {
        success: true,
        agent: agentName,
        output,
        meta: { traceId, pid: process.pid, model: llm.model, duration_ms: Date.now() - startedAt },
      })
    } catch (error) {
      console.error(`[${agentName}] trace=${traceId} failed: ${error.message}`)
      return sendJson(res, 502, { success: false, agent: agentName, message: `${definition.label} Agent 执行失败`, meta: { traceId, duration_ms: Date.now() - startedAt } })
    }
  })
  return server.listen(port, () => console.log(`${agentName} Agent listening on http://127.0.0.1:${port} pid=${process.pid}`))
}
