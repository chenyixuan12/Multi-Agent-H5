import test from 'node:test'
import assert from 'node:assert/strict'
import { TravelAgentOrchestrator, parseAgentJson } from '../src/service/travelAgents.js'

test('parseAgentJson extracts JSON wrapped in prose or code fences', () => {
  assert.deepEqual(parseAgentJson('```json\n{"ok":true}\n```', '测试 Agent'), { ok: true })
  assert.deepEqual(parseAgentJson('结果如下：{"ok":true}谢谢', '测试 Agent'), { ok: true })
})

test('orchestrator runs specialists with dependency-aware concurrency and records trace', async () => {
  const responses = {
    requirements: '{"intent":"休闲旅行","preferences":[],"constraints":{"budget":1200,"days":2}}',
    route: '{"days":[{"day":1,"area":"老城","theme":"城市漫步","sequence":["A","B","C"]},{"day":2,"area":"新城","theme":"博物馆","sequence":["D","E","F"]}]}',
    spots: '{"days":[{"day":1,"spots":[{"name":"景点A","indoor":false}]},{"day":2,"spots":[{"name":"景点D","indoor":true}]}]}',
    candidates: '{"candidates":[{"name":"地标甲","type":"地标","indoor":false,"reason":"必去"}]}',
    budget: '{"transport_advice":{"to_city":"普通列车","to_city_cost":300,"within_city":"地铁","within_city_cost":80,"to_city_alternatives":[]},"allocation":{"accommodation":300,"meals":300,"tickets":100,"transport":380,"other":50}}',
  }
  const calls = []
  let activeCalls = 0
  let maxActiveCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    activeCalls += 1
    maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
    const agent = new URL(url).port === '3401' ? 'requirements'
      : new URL(url).port === '3402' ? 'route'
        : new URL(url).port === '3403' ? 'spots'
          : new URL(url).port === '3406' ? 'candidates' : 'budget'
    await new Promise((resolve) => setTimeout(resolve, 10))
    activeCalls -= 1
    return { ok: true, json: async () => ({ success: true, output: responses[agent], meta: { pid: 1000 + calls.length } }) }
  }
  const events = []
  try {
    const orchestrator = new TravelAgentOrchestrator({
      traceId: 'test-trace',
      eventCallback: (event) => events.push(event),
    })

    const result = await orchestrator.plan({
      origin: '杭州',
      city: '北京',
      budget: 1200,
      days: 2,
      travelContext: { available: false, spots: [] },
    })

    assert.equal(calls.length, 5)
    assert.deepEqual(calls.map((call) => call.url), [
      'http://127.0.0.1:3401/run',
      'http://127.0.0.1:3402/run',
      'http://127.0.0.1:3403/run',
      'http://127.0.0.1:3406/run',
      'http://127.0.0.1:3404/run',
    ])
    assert.deepEqual(result.trace.map((item) => item.key), ['requirements', 'route', 'spots', 'candidates', 'budget'])
    assert.equal(result.route.days.length, 2)
    assert.equal(result.budget.allocation.transport, 380)
    assert.equal(events.filter((event) => event.type === 'agent_step' && event.status === 'completed').length, 5)
    const spotsCall = calls.find((call) => new URL(call.url).port === '3403')
    assert.equal(spotsCall.body.input.route, undefined)
    assert.equal(maxActiveCalls >= 2, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
