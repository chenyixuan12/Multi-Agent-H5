import express from 'express'
import travelService from '../service/travelService.js'
import { createStreamResponse } from '../utils/streamUtils.js'

const router = express.Router()

// 景点推荐接口（SSE 流式返回）
router.post('/recommend', async (req, res) => {
  try {
    const { origin, city, budget, days } = req.body

    if (!city || !budget || !days) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    const stream = createStreamResponse(res)
    const result = await travelService.recommend(
      origin,
      city,
      budget,
      days,
      (stage) => stream.send({ type: 'stage', stage: stage.key, label: stage.label }),
      undefined,
      (event) => stream.send(event),
    )

    if (result?.success === false) {
      stream.send({ type: 'error', message: result.message || '行程生成失败' })
      stream.end()
      return
    }

    stream.send({ type: 'complete', data: result })
    stream.end()
  } catch (error) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`)
      res.end()
      return
    }
    return res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// AI 对话接口（SSE 流式返回）
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body

    if (!message) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数:message',
      })
    }

    const stream = createStreamResponse(res)
    const result = await travelService.chat(message, (chunk) => {
      stream.send({ type: 'chunk', content: chunk })
    }, (stage) => stream.send({ type: 'stage', stage: stage.key, label: stage.label }))
    stream.send({ type: 'template', data: result })
    stream.end()
  } catch (error) {
    // 如果还没有发送响应头，返回错误JSON
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: error.message,
      })
    }
    // 如果已经发送了SSE响应头，发送错误事件
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`)
    res.end()
  }
})

export default router
