const writeSseBlock = (res, { event, data, id, retry } = {}) => {
  if (id !== undefined) res.write(`id: ${String(id)}\n`)
  if (event) res.write(`event: ${String(event)}\n`)
  if (retry !== undefined) res.write(`retry: ${Number(retry)}\n`)
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const lines = String(payload ?? '').split(/\r?\n/)
  lines.forEach((line) => {
    res.write(`data: ${line}\n`)
  })
  res.write('\n')
}

export const createStreamResponse = (res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  return {
    send: (data) => {
      try {
        writeSseBlock(res, { data })
      } catch (err) {
        console.error('流式发送错误', err)
      }
    },
    event: (event, data) => {
      try {
        writeSseBlock(res, { event, data })
      } catch (err) {
        console.error('流式事件发送错误', err)
      }
    },
    comment: (text = '') => {
      try {
        res.write(`: ${String(text)}\n\n`)
      } catch (err) {
        console.error('流式注释发送错误', err)
      }
    },
    end: () => {
      try {
        writeSseBlock(res, { event: 'end', data: { done: true } })
        res.end()
      } catch (err) {
        console.error('流式结束失败', err)
      }
    },
    error: (message) => {
      try {
        writeSseBlock(res, { event: 'error', data: { message } })
      } catch (err) {
        console.error('流式错误失败', err)
      }
    },
  }
}
