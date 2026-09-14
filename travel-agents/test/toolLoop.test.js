import test from 'node:test'
import assert from 'node:assert/strict'
import { HumanMessage } from '@langchain/core/messages'
import { runWithTools } from '../src/agentRuntime.js'

const fakeTool = (name, impl) => ({
  name,
  invoke: async (args) => impl?.(args) ?? { ok: true },
})

const makeLlm = (script) => {
  const calls = []
  return {
    calls,
    async invoke(messages, options) {
      const step = script[Math.min(calls.length, script.length - 1)]
      calls.push({ messages, options })
      return typeof step === 'function' ? step(calls.length - 1) : step
    },
  }
}

const buildMessages = async () => [new HumanMessage('输入')]

test('runWithTools executes tool calls and returns the final text', async () => {
  const llm = makeLlm([
    {
      content: '',
      tool_calls: [{ id: 'call_1', name: 'get_weather', args: { citycode: '110000' } }],
    },
    { content: '{"ok":true}', tool_calls: [] },
  ])
  const tools = [fakeTool('get_weather', (args) => ({ citycode: args.citycode, weather: '晴' }))]

  const output = await runWithTools({ llm, tools, buildMessages })

  assert.equal(output, '{"ok":true}')
  assert.equal(llm.calls.length, 2)
  // 工具执行结果必须作为 ToolMessage 放回消息列表，供模型继续推理
  const toolMessage = llm.calls[1].messages[2]
  assert.equal(toolMessage._getType?.() ?? toolMessage.constructor.name, 'tool')
  assert.match(String(toolMessage.content), /"weather":"晴"/)
})

test('runWithTools stops immediately when the model does not call tools', async () => {
  const llm = makeLlm([{ content: '直接回答', tool_calls: [] }])
  const output = await runWithTools({ llm, tools: [], buildMessages })
  assert.equal(output, '直接回答')
  assert.equal(llm.calls.length, 1)
})

test('runWithTools reports unknown tool results back to the model', async () => {
  const llm = makeLlm([
    { content: '', tool_calls: [{ id: 'call_9', name: 'no_such_tool', args: {} }] },
    { content: '继续', tool_calls: [] },
  ])
  const output = await runWithTools({ llm, tools: [], buildMessages })
  assert.equal(output, '继续')
  const toolMessage = llm.calls[1].messages[2]
  assert.match(String(toolMessage.content), /未知工具/)
})

test('runWithTools stops after maxIterations and returns whatever was produced', async () => {
  const llm = makeLlm([() => ({
    content: '',
    tool_calls: [{ id: 'call_x', name: 'spin', args: {} }],
  })])
  const tools = [fakeTool('spin')]
  const output = await runWithTools({
    llm,
    tools,
    buildMessages,
  })
  assert.equal(output, '')
  // 最多执行 AGENT_TOOL_MAX_ITERATIONS（默认 5）次模型调用
  assert.equal(llm.calls.length, 5)
})

test('runWithTools forwards tool outputs through streamOutput when provided', async () => {
  const streamed = []
  const llm = makeLlm([
    { content: '', tool_calls: [{ id: 'call_2', name: 'search_spots', args: { city: '北京' } }] },
    { content: '{"candidates":[]}', tool_calls: [] },
  ])
  const tools = [fakeTool('search_spots', (args) => ({ spots: [`${args.city}景点`] }))]
  const output = await runWithTools({
    llm,
    tools,
    buildMessages,
    streamOutput: (content) => streamed.push(content),
  })
  assert.equal(output, '{"candidates":[]}')
  assert.ok(streamed.length >= 1)
  assert.match(streamed.join(''), /北京景点/)
})

test('runWithTools feeds tool failures back so the model can recover', async () => {
  const llm = makeLlm([
    { content: '', tool_calls: [{ id: 'call_3', name: 'get_weather', args: {} }] },
    { content: '{"fallback":true}', tool_calls: [] },
  ])
  const tools = [fakeTool('get_weather', () => { throw new Error('接口超时') })]
  const output = await runWithTools({ llm, tools, buildMessages })
  assert.equal(output, '{"fallback":true}')
  const toolMessage = llm.calls[1].messages[2]
  assert.match(String(toolMessage.content), /工具调用失败/)
})
