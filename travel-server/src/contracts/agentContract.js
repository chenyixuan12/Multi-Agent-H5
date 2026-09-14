export const AGENT_URLS = {
    requirements: process.env.REQUIREMENTS_AGENT_URL || 'http://127.0.0.1:3401',
    route: process.env.ROUTE_AGENT_URL || 'http://127.0.0.1:3402',
    spots: process.env.SPOTS_AGENT_URL || 'http://127.0.0.1:3403',
    budget: process.env.BUDGET_AGENT_URL || 'http://127.0.0.1:3404',
    synthesis: process.env.SYNTHESIS_AGENT_URL || 'http://127.0.0.1:3405',
    candidates: process.env.CANDIDATES_AGENT_URL || 'http://127.0.0.1:3406',
  }

export const createTraceId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export async function callRemoteAgent(name, input, {
  traceId = createTraceId(),
  taskId = traceId,
  timeoutMs = Number(process.env.AGENT_TIMEOUT_MS || 45000),
  idleTimeoutMs = Number(process.env.AGENT_IDLE_TIMEOUT_MS || 90000),
  retries = Number(process.env.AGENT_RETRIES || 0),
  onStart,
  onComplete,
  onToken,
  stream = false,
} = {}) {
  const url = AGENT_URLS[name]
  if (!url) throw new Error(`未配置 ${name} Agent 地址`)
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    let timer = setTimeout(() => controller.abort(), stream ? idleTimeoutMs : timeoutMs)
    const resetTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), stream ? idleTimeoutMs : timeoutMs)
    }
    onStart?.({ name, attempt: attempt + 1, traceId })
    try {
      const response = await fetch(`${url}/run${stream ? '?stream=1' : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
          ...(stream ? { Accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify({ traceId, taskId, input }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.message || `${name} Agent HTTP ${response.status}`)
      }

      if (stream) {
        if (!response.body) throw new Error(`${name} Agent 不支持流式响应`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let full = ''
        let meta = null
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          resetTimer()
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split(/\r?\n\r?\n/)
          buffer = blocks.pop() || ''
          for (const block of blocks) {
            for (const line of block.split(/\r?\n/)) {
              if (!line.startsWith('data:')) continue
              let payload
              try {
                payload = JSON.parse(line.slice(5).trim())
              } catch {
                continue
              }
              if (payload.type === 'token') {
                const content = payload.content || ''
                full += content
                onToken?.(content, payload)
              } else if (payload.type === 'done') {
                full = payload.output || full
                meta = payload.meta || meta
              } else if (payload.type === 'error') {
                throw new Error(payload.message || `${name} Agent 流式失败`)
              }
            }
          }
        }
        if (!full.trim()) throw new Error(`${name} Agent 返回为空`)
        onComplete?.({ name, attempt: attempt + 1, traceId, meta })
        return full
      }

      const payload = await response.json().catch(() => null)
      if (!payload?.success) {
        throw new Error(payload?.message || `${name} Agent HTTP ${response.status}`)
      }
      onComplete?.({ name, attempt: attempt + 1, traceId, meta: payload.meta })
      return payload.output
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error(stream
          ? `${name} Agent 流式响应超时（${idleTimeoutMs}ms 无数据）`
          : `${name} Agent 请求超时（${timeoutMs}ms）`)
        : error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error(`${name} Agent 调用失败`)
}
