import { callRemoteAgent, createTraceId } from '../contracts/agentContract.js'

const extractBalancedJson = (text) => {
  const start = String(text || '').search(/[\[{]/)
  if (start < 0) return null
  const opening = text[start]
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === opening) depth += 1
    else if (char === closing) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

export const parseAgentJson = (content, agentName = 'agent') => {
  const normalized = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(normalized) } catch {
    const balanced = extractBalancedJson(normalized)
    if (!balanced) throw new Error(`${agentName} 返回了不可解析的 JSON`)
    try { return JSON.parse(balanced) } catch (error) { throw new Error(`${agentName} JSON 解析失败：${error.message}`) }
  }
}

const AGENT_LABELS = { requirements: '需求分析 Agent', route: '路线规划 Agent', spots: '景点筛选 Agent', budget: '预算评估 Agent', synthesis: '行程整合 Agent', candidates: '地标候选 Agent' }

export class TravelAgentOrchestrator {
  constructor({ stageCallback, eventCallback, traceId = createTraceId(), taskId = traceId } = {}) {
    this.stageCallback = stageCallback
    this.eventCallback = eventCallback
    this.traceId = traceId
    this.taskId = taskId
    this.trace = []
  }

  async runAgent(name, input, { parseJson = true, stream = false, onToken } = {}) {
    const label = AGENT_LABELS[name] || `${name} Agent`
    const startedAt = Date.now()
    this.stageCallback?.({ key: name, label: `${label} 正在执行` })
    this.eventCallback?.({ type: 'agent_step', step: name, status: 'running', traceId: this.traceId })
    try {
      const raw = await callRemoteAgent(name, input, {
        traceId: this.traceId,
        taskId: this.taskId,
        stream,
        onStart: ({ attempt }) => this.eventCallback?.({ type: 'agent_call', agent: name, status: 'running', attempt }),
        onToken: stream ? (content, payload) => onToken?.(content, payload) : undefined,
      })
      const output = parseJson ? parseAgentJson(raw, label) : raw
      const duration = Date.now() - startedAt
      this.trace.push({ key: name, label, status: 'completed', duration_ms: duration, process: '独立 HTTP 进程' })
      this.eventCallback?.({ type: 'agent_step', step: name, status: 'completed', duration_ms: duration, traceId: this.traceId })
      return output
    } catch (error) {
      this.trace.push({ key: name, label, status: 'failed', duration_ms: Date.now() - startedAt, process: '独立 HTTP 进程' })
      this.eventCallback?.({ type: 'agent_step', step: name, status: 'failed', message: error.message, traceId: this.traceId })
      throw error
    }
  }

  async plan({ origin, city, budget, days, travelContext, transportStrategy }) {
    const base = { origin, city, budget: Number(budget), days: Number(days), transportStrategy, travelContext }
    const requirements = await this.runAgent('requirements', base)
    // Route and spot selection share the requirements/context but do not depend
    // on each other. Run them concurrently to remove one full model round trip.
    const [route, spots] = await Promise.all([
      this.runAgent('route', { ...base, requirements }).catch((error) => {
        console.info(`[orchestrator] route failed, using fallback: ${error.message}`)
        return {
          days: Array.from({ length: Math.max(1, Number(days) || 1) }, (_, index) => ({
            day: index + 1,
            area: city,
            theme: '城市代表性景点与周边动线',
            sequence: [],
            route_notes: '路线 Agent 暂不可用，已由行程整合 Agent 根据实时景点数据安排',
          })),
          route_rationale: '路线服务暂不可用，采用按天就近安排的兜底策略',
        }
      }),
      this.runAgent('spots', { ...base, requirements }).catch((error) => {
        console.info(`[orchestrator] spots failed, using realtime POI fallback: ${error.message}`)
        return { days: [], selection_notes: ['景点筛选服务暂不可用，使用实时 POI 和整合 Agent 兜底'] }
      }),
    ])
    let candidates = null;
    try {
      candidates = await this.runAgent('candidates', { ...base, requirements, route, spots })
      console.info(`[orchestrator] candidates=${JSON.stringify((candidates?.candidates || []).map((c) => c?.name))}`)
    } catch (error) {
      console.info(`[orchestrator] candidates failed: ${error.message}`)
      // 候选 Agent 失败不阻断主流程，直接用原 spots 兜底
      candidates = null
    }
    const budgetPlan = await this.runAgent('budget', { ...base, requirements, route, spots })
    return { requirements, route, spots,candidates, budget: budgetPlan, trace: this.trace }
  }

  async synthesize(input, { onToken } = {}) {
    return this.runAgent('synthesis', input, { parseJson: false, stream: true, onToken })
  }
}

export default TravelAgentOrchestrator
