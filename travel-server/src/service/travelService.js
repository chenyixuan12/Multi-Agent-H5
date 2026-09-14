import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import 'dotenv/config'
import travelDataService from './travelDataService.js'
import validationService from './travelValidationService.js'
import { TravelAgentOrchestrator } from './travelAgents.js'

class TravelService {
  constructor() {
    this.llm = null
  }

  initLLM() {
    const provider = process.env.MODEL_PROVIDER
    let apiKey, baseURL, model

    if (provider === 'deepseek') {
      apiKey = process.env.LLM_API_KEY
      baseURL = process.env.LLM_API_BASE
      model = process.env.LLM_MODEL
      
    } else {
      apiKey = process.env.ALIYUN_API_KEY
      baseURL = process.env.ALIYUN_API_BASE
      model = process.env.ALIYUN_MODEL
    }

    if (!apiKey || !baseURL || !model) {
      throw new Error(`大模型配置不完整，请检查 ${provider === 'deepseek' ? 'LLM' : 'ALIYUN'}_* 环境变量`)
    }

    this.llm = new ChatOpenAI({
      configuration: {
        baseURL,
      },
      apiKey,
      model,
      temperature: 0.7,
      streaming: true,
      // Some OpenAI-compatible providers return a usage-only final chunk
      // without `choices`. LangChain tries to parse that chunk by default,
      // which can fail after all response tokens have already been delivered.
      streamUsage: false,
      maxTokens: Number(process.env.LLM_MAX_TOKENS || 4096),
      // DashScope/Qwen 通过 OpenAI 兼容接口接收该参数；关闭后可避免长时间思考再输出。
      modelKwargs: provider === 'aliyun'
        ? { enable_thinking: process.env.LLM_ENABLE_THINKING !== 'false' }
        : {},
    })
  }

  ensureLLM() {
    if (!this.llm) this.initLLM()
    return this.llm
  }

  // 以 YYYY-MM-DD 字符串做纯日期偏移，避免 toISOString 的时区换算导致日期回退。
  addDays(dateStr, offset) {
    const [year, month, day] = String(dateStr || '').split('-').map(Number)
    if (!year || !month || !day) return dateStr
    return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10)
  }

  async recommend(origin, city, budget, days, stageCallback, streamCallback, eventCallback) {
    if (budget < 200 || days < 1 || days > 30 || !origin || !city) {
      throw new Error('出发地、目的地不能为空且预算需满足要求')
    }

    const startedAt = Date.now()
    const timings = {}
    console.info(`[travel/recommend] start city=${city} days=${days} budget=${budget}`)
    const measure = async (name, task) => {
      const stepStartedAt = Date.now()
      try {
        return await task()
      } finally {
        timings[name] = Date.now() - stepStartedAt
        console.info(`[travel/recommend] ${name}=${timings[name]}ms`)
      }
    }
    const reportTimings = () => {
      const data = { ...timings, total_ms: Date.now() - startedAt }
      console.info(`[travel/recommend] ${JSON.stringify(data)}`)
      eventCallback?.({ type: 'timing', data })
      return data
    }

    let agentPlan = null
    try {
      stageCallback?.({ key: 'data', label: '正在获取天气、景点和路线数据' })
      // 行程统一从明天（当天 + 1 天）开始：车次、天气、每日日期都以此为准。
      const startDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      const trainDate = startDate
      // Treat the requested days as calendar days: a three-day trip starting
      // tomorrow returns on the third day.
      const returnDate = this.addDays(startDate, Math.max(0, Number(days) - 1))
      const travelContext = await measure('context_ms', () => travelDataService.getContext(origin, city, trainDate, returnDate))
      eventCallback?.({
        type: 'data_context',
        available: travelContext.available,
        sources: travelContext.sources,
        message: travelContext.message,
        weather: travelContext.weather,
        fetchedAt: new Date().toISOString(),
      })
      const transportStrategy = this.getTransportStrategy(budget, days, travelContext)
      const orchestrator = new TravelAgentOrchestrator({
        llm: this.llm,
        stageCallback,
        eventCallback,
      })
      agentPlan = await measure(
        'agent_orchestration_ms',
        () => orchestrator.plan({
          origin,
          city,
          budget,
          days,
          transportStrategy,
          travelContext,
        }),
      )
      eventCallback?.({
        type: 'agent_context',
        agents: agentPlan.trace.map(({ key, label, status, duration_ms }) => ({ key, label, status, duration_ms })),
      })
          // 方案A：candidates Agent 列必去地标 → 直接合并进 spots（标记 prederred）
      if (agentPlan.candidates?.candidates?.length) {
        console.info(`[travel/recommend] merge candidates=${JSON.stringify(agentPlan.candidates.candidates.map((c) => c?.name))}`)
        const seen = new Set(travelContext.spots.map((s) => s.name))
        travelContext.spots = [
          ...agentPlan.candidates.candidates.map((c) => ({
            name: c.name,
            address: '地标信息（请以景区官方公告为准）',
            location: null,
            type: c.type || '地标',
            tel: null,
            preferred: true,
          })),
          ...travelContext.spots.filter((s) => !seen.has(s.name)),
        ].slice(0, 25)
      }
      const modelStartedAt = Date.now()
      const jsonState = { buffer: '', depth: 0, inString: false, escaped: false }
      let firstTokenAt = 0
      let fullResponse = ''
      try {
        fullResponse = await orchestrator.synthesize({
          origin,
          city,
          budget: Number(budget),
          days: Number(days),
          startDate,
          endDate: returnDate,
          transportStrategy,
          travelContext,
          agents: agentPlan,
        }, {
          // 模型边生成边把 token 增量喂给 JSONL 解析器，field/meta 等事件实时转发给前端渲染
          onToken: (content) => {
            if (!firstTokenAt) firstTokenAt = Date.now()
            this.consumeJsonEvents(content, jsonState, eventCallback)
          },
        })
      } catch (error) {
        // 行程整合 Agent 不可用时，继续使用实时 POI、候选地标和本地兜底规则生成完整行程。
        console.info(`[travel/recommend] synthesis failed, using fallback: ${error.message}`)
        eventCallback?.({ type: 'agent_fallback', agent: 'synthesis', message: error.message })
      }
      timings.model_ttfb_ms = firstTokenAt ? firstTokenAt - modelStartedAt : Date.now() - modelStartedAt
      if (fullResponse) streamCallback?.(fullResponse)
      timings.model_generation_ms = Date.now() - modelStartedAt
      if (fullResponse) eventCallback?.({ type: 'agent_step', step: 'synthesis', status: 'completed' })

      stageCallback?.({ key: 'verification', label: '正在核验推荐景点' })
      const parsedPlan = fullResponse.trim() ? this.parsePlanResponse(fullResponse) : {}
      console.info(`[travel/recommend] synthesis_preview=${String(fullResponse).slice(0, 1200)}`)
      console.info(`[travel/recommend] parsed_plan keys=${Object.keys(parsedPlan || {}).join(',')} schedule=${parsedPlan?.daily_schedule?.length || 0} budget=${Boolean(parsedPlan?.budget_breakdown)} notes=${parsedPlan?.notes?.length || 0} transport=${Boolean(parsedPlan?.transport_advice)}`)
      let result = this.ensurePlanCompleteness(parsedPlan, {
        origin,
        city,
        budget,
        days,
        startDate,
        agentPlan,
        travelContext,
      })
      result = await measure(
        'poi_verification_ms',
        () => travelDataService.verifyPlanSpots(result, city, travelContext.spots || []),
      )
      // POI verification can only enrich a plan. Keep the generated schedule
      // visible when an upstream provider is unavailable or returns a partial
      // result; unverified items are marked by travelDataService instead.
      result = this.ensurePlanCompleteness(result, {
        origin,
        city,
        budget,
        days,
        startDate,
        agentPlan,
        travelContext,
      })
      result = this.normalizeRailwayAdvice(result, travelContext.railway, budget, days)
      result = validationService.reconcileTransportBudget(result, budget)
      result = this.fitBudgetToTarget(result, budget)
      eventCallback?.({ type: 'poi_verification', status: 'completed' })

      const postValidation = process.env.POST_VALIDATE === 'true'
      let validation = { valid: true, needsReplan: false, issues: [], skipped: true }
      if (postValidation) {
        eventCallback?.({ type: 'agent_step', step: 'validation', status: 'running' })
        validation = await measure(
          'validation_ms',
          () => this.runAgentValidation(result, budget, travelContext, eventCallback),
        )
        console.info(`[travel/recommend] validation.issues=${JSON.stringify(validation.issues || [])}`)
        eventCallback?.({ type: 'plan_validation', ...validation })
      } else {
        console.info('[travel/recommend] post validation disabled; using weather-aware initial plan')
        eventCallback?.({ type: 'plan_validation', valid: true, skipped: true, issues: [] })
      }

      const autoReplan = process.env.AUTO_REPLAN === 'true'
      if (postValidation && validation.needsReplan && autoReplan) {
        stageCallback?.({ key: 'replan', label: '校验发现问题，Agent 正在自动调整行程' })
        eventCallback?.({ type: 'agent_step', step: 'replan', status: 'running', issues: validation.issues })
        const revisedResponse = await measure(
          'replan_ms',
          () => this.revisePlan(result, validation, origin, city, budget, days, eventCallback),
        )
        if (revisedResponse) {
          const revisedPlan = await measure(
            'replan_poi_verification_ms',
          () => travelDataService.verifyPlanSpots(this.ensurePlanCompleteness(this.parsePlanResponse(revisedResponse), {
            origin,
            city,
            budget,
            days,
            startDate,
            agentPlan,
            travelContext,
          }), city, travelContext.spots || []),
          )
          result = validationService.reconcileTransportBudget(revisedPlan, budget)
          validation = await measure(
            'replan_validation_ms',
            () => validationService.validatePlan(result, {
              budget,
              weather: travelContext.weather,
              travelDataService,
            }),
          )
          console.info(`[travel/recommend] validation.issues.retry=${JSON.stringify(validation.issues || [])}`)
          eventCallback?.({ type: 'plan_validation', ...validation, retry: 1 })
        }
        eventCallback?.({ type: 'agent_step', step: 'replan', status: 'completed' })
      } else if (postValidation && validation.needsReplan) {
        console.info('[travel/recommend] auto replan disabled; keeping original plan')
      }
      if (postValidation) {
        eventCallback?.({ type: 'agent_step', step: 'validation', status: validation.valid ? 'completed' : 'warning' })
      }
      const performance = reportTimings()
      return {
        ...result,
        start_date: startDate,
        end_date: returnDate,
        performance,
        data_sources: travelContext.sources,
        realtime_data: travelContext.available,
        realtime_context: {
          weather: travelContext.weather,
          sources: travelContext.sources,
          fetchedAt: new Date().toISOString(),
        },
        agent_validation: validation,
        agent_trace: agentPlan?.trace || [],
      }
    } catch (err) {
      const performance = reportTimings()
      return {
        success: false,
        message: err.message,
        performance,
      }
    }
  }

  async runAgentValidation(plan, budget, travelContext) {
    // 规划结果已经在服务端具备完整结构；本地校验规则无需再发起一次模型调用。
    return validationService.validatePlan(plan, {
      budget,
      weather: travelContext.weather,
      travelDataService: travelDataService,
    })
  }

  normalizeRailwayAdvice(plan, railway, budget, days) {
    if (!railway?.outbound?.result || !railway?.inbound?.result) return plan
    const strategy = this.getTransportStrategyDetails(budget, days, railway)
    const outbound = this.extractRailwayOption(railway.outbound.result, strategy.railwayPreference, {
      preferredDepartureFrom: '06:00',
    })
    // A two-day trip should normally use the second half of the return day.
    // Prefer an afternoon/evening departure whenever the live result contains one.
    const inbound = this.extractRailwayOption(railway.inbound.result, strategy.railwayPreference, {
      preferredDepartureFrom: '18:00',
      targetDepartureFrom: '20:00',
      targetDepartureTo: '21:00',
    })
    if (!outbound || !inbound) return plan
    const current = plan.transport_advice || {}
    const seatLabel = outbound.seat || '可用席别'
    return {
      ...plan,
      transport_advice: {
        ...current,
        to_city: `去程${outbound.train}（${outbound.departure}-${outbound.arrival}，${seatLabel}${outbound.price}元）+ 返程${inbound.train}（${inbound.departure}-${inbound.arrival}，${inbound.seat || seatLabel}${inbound.price}元）`,
        to_city_cost: outbound.price + inbound.price,
        to_city_alternatives: [],
      },
    }
  }

  extractRailwayOption(text, preference = 'second_class', options = {}) {
    const lines = String(text || '').split(/\r?\n/)
    const candidates = []
    const preferenceOrder = preference === 'comfort'
      ? ['二等座', '一等座', '商务座', '软卧', '硬卧', '硬座', '无座']
      : preference === 'economy'
        ? ['硬座', '硬卧', '二等座', '软卧', '一等座', '商务座', '无座']
        : preference === 'second_class'
          ? ['二等座']
          : ['二等座', '硬卧', '硬座', '一等座', '软卧', '商务座', '无座']
    const seatRank = (seat) => {
      const rank = preferenceOrder.indexOf(seat)
      return rank < 0 ? Number.MAX_SAFE_INTEGER : rank
    }

    const isTrainLine = (line) => /\b[A-Z]\d{1,5}\b/.test(line) && /\d{2}:\d{2}\s*(?:->|→|[-—至])\s*\d{2}:\d{2}/.test(line)
    const seatPattern = /(商务座|一等座|二等座|软卧|硬卧|硬座|无座)/u
    const parseSeat = (line) => {
      const seatMatch = line.match(seatPattern)
      if (!seatMatch) return null
      const type = seatMatch[1]
      const tail = line.slice((seatMatch.index ?? 0) + seatMatch[0].length)
      const unavailable = /(无票|无余票|售罄|候补)/u.test(tail)
      const available = !unavailable && /(有票|有余票|剩余\s*\d+\s*张票|剩余\s*\d+)/u.test(tail)
      const priceMatch = tail.match(/(\d+(?:\.\d+)?)\s*(?:元|￥|¥)/u) || line.match(/(?:票价|价格)\s*[:：]?\s*(\d+(?:\.\d+)?)/u)
      if (!priceMatch) return null
      return { type, available: available && !unavailable, price: Number(priceMatch[1]) }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!isTrainLine(line)) continue
      const train = line.match(/\b[A-Z]\d{1,5}\b/)?.[0]
      const times = line.match(/(\d{2}:\d{2})\s*(?:->|→|[-—至])\s*(\d{2}:\d{2})/)
      if (!train || !times) continue

      const seats = []
      for (let cursor = index + 1; cursor < lines.length && !isTrainLine(lines[cursor]); cursor += 1) {
        const seat = parseSeat(lines[cursor])
        if (seat) seats.push(seat)
      }
      const available = seats.filter((seat) => seat.available
        && (preference !== 'second_class' || seat.type === '二等座'))
      const preferred = available
        .sort((a, b) => seatRank(a.type) - seatRank(b.type) || a.price - b.price)[0]
      if (preferred) candidates.push({ train, departure: times[1], arrival: times[2], seat: preferred.type, price: preferred.price })
    }
    const preferredCandidates = options.preferredDepartureFrom
      ? candidates.filter((candidate) => candidate.departure >= options.preferredDepartureFrom)
      : candidates
    const pool = preferredCandidates.length ? preferredCandidates : candidates
    const toMinutes = (value) => {
      const match = String(value || '').match(/^(\d{2}):(\d{2})$/)
      return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN
    }
    const targetFrom = toMinutes(options.targetDepartureFrom)
    const targetTo = toMinutes(options.targetDepartureTo)
    const hasTargetRange = Number.isFinite(targetFrom) && Number.isFinite(targetTo)
    const timeRank = (candidate) => {
      const departure = toMinutes(candidate.departure)
      if (hasTargetRange && departure >= targetFrom && departure <= targetTo) return 0
      if (options.preferredDepartureFrom && candidate.departure >= options.preferredDepartureFrom) return 1
      return 2
    }
    const timeDistance = (candidate) => {
      const departure = toMinutes(candidate.departure)
      if (hasTargetRange) {
        if (departure < targetFrom) return targetFrom - departure
        if (departure > targetTo) return departure - targetTo
        return 0
      }
      return departure
    }
    return pool.sort((a, b) => {
      const seatDiff = seatRank(a.seat) - seatRank(b.seat)
      const timeDiff = timeRank(a) - timeRank(b)
      // Within the desired 20:00-21:00 window, price is the tie breaker;
      // outside it, choose the departure closest to the desired evening.
      const priceDiff = a.price - b.price
      return seatDiff || timeDiff || (timeRank(a) === 0 ? priceDiff : timeDistance(a) - timeDistance(b) || priceDiff) || a.departure.localeCompare(b.departure)
    })[0] || null
  }

  async revisePlan(plan, validation, origin, city, budget, days, eventCallback) {
    const llm = this.ensureLLM()
    const prompt = new HumanMessage(`
你是行程修订 Agent。请根据校验问题修订下面的旅行计划，只输出 JSONL 事件，不要 Markdown 或解释。
出发地：${origin}；目的地：${city}；预算：${budget}；天数：${days}
校验问题：${JSON.stringify(validation.issues)}
原计划：${JSON.stringify(plan)}
要求：保留未受影响的时间段；超预算时降低门票、交通或餐饮费用；天气有雨时把受影响的户外景点换成博物馆、美术馆、商场等室内地点；交通建议必须保留唯一计入预算的主方案、to_city_cost 和 within_city_cost，低预算优先普通列车、夜车或合理中转；可给出不计入预算的 to_city_alternatives。budget_breakdown.transport 严格等于两项主方案费用之和；输出完整的 meta、每个时间段的 field、transport_advice、budget_breakdown、notes 事件。
`)
    const stream = await llm.stream([new SystemMessage('你是严格遵守 JSONL 输出格式的旅游行程修订 Agent。'), prompt])
    let fullResponse = ''
    const jsonState = { buffer: '', depth: 0, inString: false, escaped: false }
    for await (const chunk of stream) {
      const content = this.extractChunkText(chunk.content)
      if (!content) continue
      fullResponse += content
      this.consumeJsonEvents(content, jsonState, eventCallback)
    }
    return fullResponse.trim() ? fullResponse : null
  }

  extractChunkText(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''

    return content.map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      return typeof part.text === 'string'
        ? part.text
        : typeof part.content === 'string'
          ? part.content
          : ''
    }).join('')
  }

  parseJsonResponse(content) {
    const normalized = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
    try {
      return JSON.parse(normalized)
    } catch (error) {
      // 模型偶尔会在 JSON 后追加说明，提取第一个完整 JSON 值容错处理。
      const start = normalized.search(/[\[{]/)
      if (start >= 0) {
        const value = this.extractBalancedJson(normalized, start)
        if (value) return JSON.parse(value)
      }
      console.error(`[travel/recommend] response_parse_failed=${error.message}; preview=${normalized.slice(0, 500)}`)
      throw error
    }
  }

  extractBalancedJson(content, start = 0) {
    const opening = content[start]
    if (opening !== '{' && opening !== '[') return null
    const closing = opening === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < content.length; index += 1) {
      const char = content[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
      } else if (char === opening) {
        depth += 1
      } else if (char === closing) {
        depth -= 1
        if (depth === 0) return content.slice(start, index + 1)
      }
    }
    return null
  }

  emitPlanEvent(line, eventCallback) {
    const normalized = line.trim().replace(/^```(?:jsonl?|json)?\s*/i, '').replace(/\s*```$/i, '')
    if (!normalized) return
    try {
      const event = JSON.parse(normalized)
      if (event?.type) eventCallback?.(event)
    } catch {
      // A token boundary can leave an incomplete line; final parsing reports malformed output.
    }
  }

  consumeJsonEvents(content, state, eventCallback) {
    for (const char of content) {
      if (state.depth === 0) {
        if (char === '{') {
          state.buffer = char
          state.depth = 1
          state.inString = false
          state.escaped = false
        }
        continue
      }

      state.buffer += char
      if (state.inString) {
        if (state.escaped) state.escaped = false
        else if (char === '\\') state.escaped = true
        else if (char === '"') state.inString = false
        continue
      }

      if (char === '"') state.inString = true
      else if (char === '{') state.depth += 1
      else if (char === '}') {
        state.depth -= 1
        if (state.depth === 0) {
          this.emitPlanEvent(state.buffer, eventCallback)
          state.buffer = ''
        }
      }
    }
  }

  normalizePlanShape(plan, { city, budget, days, startDate } = {}) {
    let value = plan
    if (value && typeof value === 'object' && value.data && typeof value.data === 'object' && !Array.isArray(value.data)) {
      value = value.data
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {}

    const normalizePeriod = (period) => ({
      noon: 'afternoon',
      lunch: 'afternoon',
      midday: 'afternoon',
      中午: 'afternoon',
      午餐: 'afternoon',
      上午: 'morning',
      早上: 'morning',
      晚上: 'evening',
    }[String(period || '').toLowerCase()] || period)
    const scheduleInput = Array.isArray(value.daily_schedule)
      ? value.daily_schedule
      : Array.isArray(value.schedule) ? value.schedule
        : Array.isArray(value.days) ? value.days : []
    const schedule = scheduleInput.map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const day = Number(item.day ?? item.day_number ?? index + 1)
      const normalized = { day: Number.isFinite(day) && day > 0 ? day : index + 1 }
      if (startDate) normalized.date = this.addDays(startDate, normalized.day - 1)
      for (const [key, slot] of Object.entries(item)) {
        const period = normalizePeriod(key)
        if (['morning', 'afternoon', 'evening'].includes(period)) normalized[period] = slot
      }
      return normalized
    }).filter(Boolean)

    const transport = value.transport_advice || value.transport || null
    const breakdown = value.budget_breakdown || value.budgetBreakdown || value.allocation || null
    const notes = Array.isArray(value.notes) ? value.notes : (value.notes ? [value.notes] : [])
    return {
      ...value,
      city: value.city || city,
      budget: value.budget ?? (Number(budget) || 0),
      days: value.days ?? (schedule.length || Number(days) || 0),
      daily_schedule: schedule,
      transport_advice: transport,
      budget_breakdown: breakdown,
      notes,
    }
  }

  buildFallbackPlan({ origin, city, budget, days, agentPlan, travelContext, startDate } = {}) {
    const requestedDays = Math.max(1, Number(days) || 1)
    const knownSpots = Array.isArray(travelContext?.spots) ? travelContext.spots : []
    const spotDays = Array.isArray(agentPlan?.spots?.days) ? agentPlan.spots.days : []
    const routeDays = Array.isArray(agentPlan?.route?.days) ? agentPlan.route.days : []
    const candidates = []
    for (let dayIndex = 0; dayIndex < requestedDays; dayIndex += 1) {
      const spotDay = spotDays.find((item) => Number(item?.day) === dayIndex + 1)
      const routeDay = routeDays.find((item) => Number(item?.day) === dayIndex + 1)
      const liveNames = new Set(knownSpots.map((item) => item?.name).filter(Boolean))
      const dayCandidates = (Array.isArray(spotDay?.spots) ? spotDay.spots : [])
        .filter((item) => !liveNames.size || liveNames.has(item?.name))
      dayCandidates.forEach((item) => candidates.push({ ...item, day: dayIndex + 1 }))
      if (!dayCandidates.length && knownSpots.length) {
        knownSpots.slice(dayIndex * 3, dayIndex * 3 + 3).forEach((item) => candidates.push({
          name: item.name,
          day: dayIndex + 1,
          reason: item.type || '实时 POI 景点',
          estimated_ticket: 0,
        }))
      }
      if (!dayCandidates.length && !knownSpots.length && Array.isArray(routeDay?.sequence)) {
        routeDay.sequence.slice(0, 3).forEach((name) => candidates.push({ name, day: dayIndex + 1, estimated_ticket: 0 }))
      }
    }

    const fallbackSchedule = []
    for (let dayIndex = 0; dayIndex < requestedDays; dayIndex += 1) {
      const dayItems = candidates.filter((item) => item.day === dayIndex + 1)
      const periods = ['morning', 'afternoon', 'evening']
      const day = { day: dayIndex + 1, ...(startDate ? { date: this.addDays(startDate, dayIndex) } : {}) }
      periods.forEach((period, periodIndex) => {
        const candidate = dayItems[periodIndex] || dayItems[dayItems.length - 1]
        if (!candidate?.name) return
        const previous = periodIndex === 0 ? '酒店/住宿地' : day[periods[periodIndex - 1]]?.spot || '上一站'
        day[period] = {
          spot: candidate.name,
          description: candidate.reason || `${city} ${candidate.name}，以现场开放信息为准`,
          ticket: Number(candidate.estimated_ticket) || 0,
          duration: '2h',
          transport: this.createDetailedTransport(previous, candidate.name, city, period),
          meal: this.resolveMealSuggestion(null, { city, spot: candidate.name, period }),
        }
      })
      fallbackSchedule.push(day)
    }

    const budgetPlan = agentPlan?.budget || {}
    const advice = budgetPlan.transport_advice || null
    const allocation = budgetPlan.allocation || {}
    const toCityCost = Number(advice?.to_city_cost) || 0
    const withinCityCost = Number(advice?.within_city_cost) || 0
    const limit = Number(budget) || 0
    const used = ['accommodation', 'meals', 'tickets', 'other'].reduce((sum, key) => sum + (Number(allocation[key]) || 0), 0)
    const remainder = Math.max(0, limit - used - toCityCost - withinCityCost)
    return {
      city,
      budget: limit,
      days: requestedDays,
      daily_schedule: fallbackSchedule,
      transport_advice: advice || {
        to_city: `从${origin || '出发地'}前往${city}的经济型铁路方案（以实时查询为准）`,
        to_city_cost: toCityCost,
        within_city: '地铁、公交和步行为主',
        within_city_cost: withinCityCost,
        to_city_alternatives: [],
      },
      budget_breakdown: {
        accommodation: Number(allocation.accommodation) || Math.round(limit * 0.35),
        meals: Number(allocation.meals) || Math.round(limit * 0.2),
        tickets: Number(allocation.tickets) || Math.round(limit * 0.1),
        transport: Number(allocation.transport) || toCityCost + withinCityCost,
        other: Number(allocation.other) || remainder,
      },
      notes: ['出行前请再次确认天气、景点开放时间和交通余票。', '行程时间和费用为估算，请以现场及官方信息为准。'],
    }
  }

  ensurePlanCompleteness(plan, context = {}) {
    const normalized = this.normalizePlanShape(plan, context)
    const fallback = this.buildFallbackPlan(context)
    const hasObjectValues = (value) => value && typeof value === 'object' && Object.keys(value).length > 0
    const fallbackByDay = new Map(fallback.daily_schedule.map((day) => [Number(day.day), day]))
    const mergedSchedule = fallback.daily_schedule.map((fallbackDay) => {
      const actualDay = normalized.daily_schedule.find((day) => Number(day.day) === Number(fallbackDay.day))
      return actualDay ? { ...fallbackDay, ...actualDay } : fallbackDay
    })
    normalized.daily_schedule.forEach((day) => {
      if (!fallbackByDay.has(Number(day.day))) mergedSchedule.push(day)
    })
    mergedSchedule.sort((a, b) => Number(a.day) - Number(b.day))
    const completed = {
      ...fallback,
      ...normalized,
      daily_schedule: mergedSchedule,
      transport_advice: hasObjectValues(normalized.transport_advice) ? normalized.transport_advice : fallback.transport_advice,
      budget_breakdown: hasObjectValues(normalized.budget_breakdown) ? normalized.budget_breakdown : fallback.budget_breakdown,
      notes: normalized.notes.length ? normalized.notes : fallback.notes,
    }
    completed.daily_schedule = this.enrichSchedule(completed.daily_schedule, context)
    completed.notes = this.ensureUsefulNotes(completed.notes, {
      ...context,
      daily_schedule: completed.daily_schedule,
      transport_advice: completed.transport_advice,
      budget_breakdown: completed.budget_breakdown,
    })
    return this.fitBudgetToTarget(completed, context.budget)
  }

  createDetailedTransport(from, to, city = '', period = 'morning') {
    const mode = period === 'evening' ? '公交/地铁+步行' : period === 'afternoon' ? '地铁或公交换乘' : '地铁/公交+步行'
    return {
      from,
      to,
      method: mode,
      route: `从${from}出发前往${to}，乘${mode}至${to}附近站点，下车后步行约10-15分钟；具体站点以${city || '当地'}地图导航为准`,
      duration: period === 'evening' ? '约25分钟' : '约30分钟',
      cost: 6,
    }
  }

  enrichSchedule(schedule, { city = '', travelContext = {}, agentPlan = {} } = {}) {
    const liveNames = (travelContext.spots || []).map((item) => item?.name).filter(Boolean)
    const agentDays = Array.isArray(agentPlan?.spots?.days) ? agentPlan.spots.days : []
    const agentNames = agentDays.flatMap((day) => (Array.isArray(day?.spots) ? day.spots : []).map((item) => item?.name)).filter(Boolean)
    const candidates = [...new Set([...liveNames, ...agentNames])]
    // 地标候选 Agent 合并进 spots 的 preferred 项即必去地标，用于替换重复/空缺时段。
    const landmarkSpots = (travelContext.spots || [])
      .filter((item) => item?.preferred)
      .map((item) => item?.name)
      .filter(Boolean)
    const used = new Set()
    const periods = ['morning', 'afternoon', 'evening']

    return (Array.isArray(schedule) ? schedule : []).map((day, dayIndex) => {
      const output = { ...day, day: Number(day.day) || dayIndex + 1 }
      periods.forEach((period, periodIndex) => {
        let slot = output[period] && typeof output[period] === 'object' ? { ...output[period] } : {}
        let spot = String(slot.spot || '').trim()
        if (!spot || used.has(spot)) {
          // 优先从地标景点中选择
          const landmarkReplacement = landmarkSpots.find((name) => !used.has(name) && candidates.includes(name))
          if (landmarkReplacement) {
            spot = landmarkReplacement
            slot = { ...slot, spot: landmarkReplacement, ticket: Number(slot.ticket) || 0 }
          } else {
            const replacement = candidates.find((name) => !used.has(name))
            if (replacement) {
              spot = replacement
              slot = { ...slot, spot: replacement, ticket: Number(slot.ticket) || 0 }
            } else if (!spot || used.has(spot)) {
              const activity = period === 'morning' ? '文化参观' : period === 'afternoon' ? '街区漫步' : '特色夜游活动'
              spot = `${city || '当地'}${activity}`
              slot = { ...slot, spot, non_poi: true, ticket: 0 }
            }
          }
        }
        used.add(spot)
        const previous = periodIndex === 0 ? '酒店/住宿地' : output[periods[periodIndex - 1]]?.spot || '上一站'
        const transport = slot.transport && typeof slot.transport === 'object' ? { ...slot.transport } : {}
        const genericRoute = !transport.route || /请以|地图导航为准$/.test(String(transport.route))
        const rawDuration = slot.duration
        output[period] = {
          ...slot,
          spot,
          description: slot.description || `${city || '目的地'}${spot}，建议预留${slot.duration || '2h'}，以官方开放信息为准`,
          duration: typeof rawDuration === 'number' && rawDuration > 0
            ? (rawDuration >= 60 ? `${Math.floor(rawDuration / 60)}h${rawDuration % 60 ? rawDuration % 60 + 'min' : ''}` : `${rawDuration}min`)
            : (rawDuration || '2h'),
          ticket: Number.isFinite(Number(slot.ticket)) ? Number(slot.ticket) : 0,
          transport: genericRoute
            ? { ...this.createDetailedTransport(previous, spot, city, period), cost: Number(transport.cost) || 6 }
            : { ...transport, method: transport.method || transport.mode, from: transport.from || previous, to: transport.to || spot },
          meal: this.resolveMealSuggestion(slot.meal, { city, spot, period }),
        }
      })
      return output
    })
  }

  resolveMealSuggestion(meal, { spot = '', period = 'morning' } = {}) {
    if (meal && typeof meal === 'string') return { recommendation: meal, cost: period === 'evening' ? 60 : 45 }
    const source = meal && typeof meal === 'object' ? meal : {}
    const text = String(source.recommendation || source.name || source.text || '').trim()
    if (text && !/当地特色餐饮|当地特色午餐|特色菜（请根据附近餐馆菜单选择）/.test(text)) {
      return { ...source, recommendation: text, cost: Number(source.cost) || (period === 'evening' ? 60 : 45) }
    }
    const periodHint = period === 'morning' ? '早餐' : period === 'evening' ? '晚餐' : '午餐'
    return {
      recommendation: `当地特色菜，具体以${spot ? spot + '附近' : '目的地'}餐馆菜单为准，适合${periodHint}`,
      cost: period === 'evening' ? 60 : 45,
    }
  }

  ensureUsefulNotes(notes, plan = {}) {
    const output = (Array.isArray(notes) ? notes : [notes]).map((note) => typeof note === 'string' ? note.trim() : note?.text || note?.message || '').filter(Boolean)
    const { city = '', budget = 0, daily_schedule = [], transport_advice = {}, budget_breakdown = {}, travelContext = {} } = plan
    // 行程从明天开始，天气提示以第一旅行日（预报第 2 条）为准，缺省时回退到今天。
    const forecasts = travelContext.weather?.forecasts || []
    const weather = forecasts[1] || forecasts[0]
    const slots = ['morning', 'afternoon', 'evening']
      .flatMap((period) => (daily_schedule || []).map((day) => day?.[period]).filter(Boolean))
    const paidSpots = [...new Set(slots.filter((slot) => Number(slot.ticket) > 0).map((slot) => slot.spot))]
    const modes = [...new Set(slots.map((slot) => slot.transport?.mode || slot.transport?.method).filter(Boolean))]

    const suggestions = []
    if (weather?.dayWeather && /雨|雪/.test(String(weather.dayWeather))) {
      suggestions.push(`${city || '目的地'}近期白天可能有${weather.dayWeather}，随身携带雨具并为户外景点预留室内替代方案。`)
    } else if (weather?.dayWeather) {
      suggestions.push(`${city || '目的地'}近期白天天气以${weather.dayWeather}为主，出发前请再次查看当天预报并适当增减衣物。`)
    }
    if (transport_advice?.to_city) {
      suggestions.push(`已为您选定城际方案：${String(transport_advice.to_city)}；出发前请核对车站与发车时间，建议提前到达车站。`)
    }
    if (paidSpots.length) {
      suggestions.push(`行程中 ${paidSpots.join('、')} 需要购票，建议提前在官方渠道查看开放时间和预约规则。`)
    }
    if (modes.length) {
      suggestions.push(`景点之间以${modes.join('、')}为主，换乘和排队时间建议各预留15-20分钟，具体以当天地图导航为准。`)
    }
    if (budget_breakdown && typeof budget_breakdown === 'object') {
      const labels = { accommodation: '住宿', meals: '餐饮', tickets: '门票', transport: '交通', other: '其他' }
      const entries = Object.entries(budget_breakdown)
        .filter(([key, value]) => labels[key] && Number(value) > 0)
        .map(([key, value]) => `${labels[key]}${value}元`)
      if (entries.length) {
        suggestions.push(`本次${budget ? `预算 ${budget} 元，` : ''}其中${entries.join('、')}，请结合实际情况弹性调整。`)
      }
    }
    suggestions.push('门票、开放时间和预约规则以景点官方渠道为准；保管好证件和随身物品。')

    for (const suggestion of suggestions) {
      if (output.length >= 6) break
      if (!output.some((item) => item.includes(suggestion.slice(0, 10)))) output.push(suggestion)
    }
    return output.slice(0, 8)
  }

  fitBudgetToTarget(plan, budget) {
    const limit = Number(budget) || 0
    if (!limit || !plan?.budget_breakdown || typeof plan.budget_breakdown !== 'object') return plan
    const amount = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
      return match ? Number(match[0]) : 0
    }
    const keys = ['accommodation', 'meals', 'tickets', 'transport', 'other']
    const breakdown = Object.fromEntries(keys.map((key) => [key, Math.max(0, amount(plan.budget_breakdown[key]))]))
    const transportAdvice = plan.transport_advice || {}
    const transport = amount(transportAdvice.to_city_cost) + amount(transportAdvice.within_city_cost)
    if (transport > 0) breakdown.transport = transport
    let total = keys.reduce((sum, key) => sum + breakdown[key], 0)
    if (total < limit) {
      let remainder = limit - total
      const otherRoom = Math.max(0, Math.floor(limit * 0.1) - breakdown.other)
      const addOther = Math.min(otherRoom, Math.round(remainder * 0.05))
      breakdown.other += addOther
      remainder -= addOther
      const weights = [['accommodation', 0.5], ['meals', 0.3], ['tickets', 0.2]]
      weights.forEach(([key, weight], index) => {
        const addition = index === weights.length - 1 ? remainder : Math.floor((limit - total) * weight)
        breakdown[key] += addition
        remainder -= addition
      })
      if (remainder > 0) breakdown.accommodation += remainder
      total = keys.reduce((sum, key) => sum + breakdown[key], 0)
    }
    if (total > limit) {
      let excess = total - limit
      for (const key of ['other', 'meals', 'tickets', 'accommodation']) {
        const reduction = Math.min(excess, breakdown[key])
        breakdown[key] -= reduction
        excess -= reduction
        if (!excess) break
      }
    }
    return { ...plan, budget_breakdown: breakdown }
  }

  parsePlanResponse(content) {
    const events = []
    const state = { buffer: '', depth: 0, inString: false, escaped: false }
    this.consumeJsonEvents(content, state, (event) => events.push(event))
    // Some model providers ignore JSONL and return one complete plan object.
    // Do not treat that object as an event container, otherwise all canonical
    // fields (daily_schedule/budget_breakdown/notes) are silently discarded.
    if (events.length === 1 && !events[0]?.type) return events[0]
    if (events.length === 1 && events[0]?.type === 'plan' && events[0].data) return events[0].data
    if (!events.length) {
      const firstObjectStart = content.search(/[\[{]/)
      if (firstObjectStart >= 0) {
        const firstObject = this.extractBalancedJson(content, firstObjectStart)
        if (firstObject) {
          try {
            const parsed = JSON.parse(firstObject)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
          } catch {
            // Fall through to the detailed parser error.
          }
        }
      }
      return this.parseJsonResponse(content)
    }

    const meta = events.find((event) => event.type === 'meta') || {}
    const normalizePeriod = (period) => ({
      noon: 'afternoon',
      lunch: 'afternoon',
      midday: 'afternoon',
      中午: 'afternoon',
      午餐: 'afternoon',
      上午: 'morning',
      早上: 'morning',
      晚上: 'evening',
    }[String(period || '').toLowerCase()] || String(period || '').toLowerCase())
    // The synthesis agent is told to emit field events, but some models output
    // one day object per line instead. Accept both the { type:'day', data:{} }
    // shape and the { type:'day', day, morning, afternoon, evening } shape so a
    // well-formed model response is never discarded for a generic fallback.
    const schedule = events.filter((event) => event.type === 'day').map((event) => {
      const source = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : event
      if (!source || typeof source !== 'object') return null
      const rawDay = Number(source.day ?? source.day_number ?? 0)
      const normalized = { day: Number.isFinite(rawDay) && rawDay > 0 ? rawDay : 0 }
      Object.entries(source).forEach(([key, value]) => {
        const period = normalizePeriod(key)
        if (['morning', 'afternoon', 'evening'].includes(period)) normalized[period] = value
      })
      return normalized
    }).filter(Boolean)
    events.filter((event) => ['schedule', 'daily_schedule'].includes(event.type)).forEach((event) => {
      const items = Array.isArray(event.data) ? event.data : [event.data]
      items.filter((item) => item && typeof item === 'object').forEach((item, index) => {
        const day = Number(item.day ?? item.day_number ?? index + 1)
        const normalized = { day: Number.isFinite(day) && day > 0 ? day : schedule.length + 1 }
        Object.entries(item).forEach(([key, value]) => {
          const period = normalizePeriod(key)
          if (['morning', 'afternoon', 'evening'].includes(period)) normalized[period] = value
        })
        const existing = schedule.find((entry) => Number(entry.day) === normalized.day)
        if (existing) Object.assign(existing, normalized)
        else schedule.push(normalized)
      })
    })
    events.filter((event) => event.type === 'slot' && event.data && event.day && event.period).forEach((event) => {
      event.period = normalizePeriod(event.period)
      let day = schedule.find((item) => item.day === event.day)
      if (!day) {
        day = { day: event.day }
        schedule.push(day)
      }
      day[event.period] = event.data
    })
    events.filter((event) => event.type === 'field' && event.value !== undefined && event.day && event.period && event.field).forEach((event) => {
      event.period = normalizePeriod(event.period)
      let day = schedule.find((item) => item.day === event.day)
      if (!day) {
        day = { day: event.day }
        schedule.push(day)
      }
      if (!day[event.period]) day[event.period] = {}
      day[event.period][event.field] = event.value
    })
    schedule.sort((a, b) => a.day - b.day)

    return {
      city: meta.city,
      budget: meta.budget,
      days: meta.days,
      daily_schedule: schedule,
      transport_advice: events.find((event) => event.type === 'transport_advice')?.data,
      budget_breakdown: events.find((event) => ['budget_breakdown', 'budget', 'allocation'].includes(event.type))?.data,
      notes: events.find((event) => ['notes', 'advice', 'tips'].includes(event.type))?.data || [],
    }
  }

  getTransportStrategy(budget, days, travelContext = null) {
    const details = this.getTransportStrategyDetails(budget, days, travelContext)
    return `${details.label}（预算约${details.dailyBudget}元/天，城际交通约占总预算${details.transportRatio}%）：${details.description}`
  }

  getTransportStrategyDetails(budget, days, travelContext = null) {
    const totalBudget = Math.max(0, Number(budget) || 0)
    const dailyBudget = Math.round(totalBudget / Math.max(1, Number(days) || 1))
    const railway = travelContext?.railway || travelContext
    const outbound = this.extractRailwayOption(railway?.outbound?.result || '', 'second_class')
    const inbound = this.extractRailwayOption(railway?.inbound?.result || '', 'second_class')
    const roundTripRailwayCost = outbound && inbound ? outbound.price + inbound.price : 0
    const transportRatio = totalBudget > 0 && roundTripRailwayCost > 0
      ? Math.round((roundTripRailwayCost / totalBudget) * 100)
      : null

    if (transportRatio !== null && transportRatio <= 20) {
      return {
        label: '舒适型', dailyBudget, transportRatio, railwayPreference: 'comfort',
        description: '实时二等座往返费用占预算较低，优先选择直达高铁/动车等省时方案，不要为了节省小额交通费降低舒适度；去程安排在上午、返程优先安排18:00后的晚间车次，尽量落在20:00-21:00并兼顾票价；仍需为住宿、餐饮、门票和应急预留预算。',
      }
    }
    if (transportRatio !== null && transportRatio >= 60) {
      return {
        label: '交通节约型', dailyBudget, transportRatio, railwayPreference: 'economy',
        description: '实时二等座往返费用已经占预算较高比例，优先选择真实查询结果中的硬座、硬卧、夜车或更便宜席别；去程安排在上午、返程优先安排18:00后的晚间车次，尽量落在20:00-21:00并兼顾票价；只有节省大量时间且预算仍能覆盖其他旅行开支时才升级。',
      }
    }
    if (transportRatio !== null) {
      return {
        label: '均衡型', dailyBudget, transportRatio, railwayPreference: 'balanced',
        description: '根据实时往返票价和剩余预算平衡时间与费用，优先直达铁路；二等座价格合理时可以选择，否则采用真实查询结果中的更经济席别；去程安排在上午、返程优先安排18:00后的晚间车次，尽量落在20:00-21:00并兼顾票价。',
      }
    }
    if (dailyBudget <= 500) {
      return {
        label: '交通节约型', dailyBudget, transportRatio: 0, railwayPreference: 'economy',
        description: '暂无完整票价数据，按预算谨慎规划，优先普通列车、硬座/硬卧和夜间列车，不能默认推荐高铁或飞机。',
      }
    }
    return {
      label: '均衡型', dailyBudget, transportRatio: 0, railwayPreference: 'balanced',
      description: '暂无完整票价数据，优先性价比高的直达铁路；仅当价格合理且不会挤占住宿、餐饮和门票预算时升级高铁或飞机。',
    }
  }

  getTravelPrompt(origin, city, budget, days, travelContext = null, agentPlan = null) {
    const transportStrategy = this.getTransportStrategy(budget, days)
    return [
      new HumanMessage(`你是行程整合 Agent，负责把前置 Agent 的结构化结果整合成一份可执行的详细旅行行程。你擅长根据用户的需求生成详细的旅行行程。

请根据以下信息为用户生成一份详细的旅游规划，并以 JSONL 格式输出：
- 出发地：${origin}
- 目的地城市：${city}
- 预算：${budget}元
- 旅行天数：${days}天
- 交通策略：${transportStrategy}

实时参考数据（如果不可用，不要编造 API 数据）：
${JSON.stringify(travelContext || { available: false }, null, 2)}

前置 Agent 分析结果（这是需求、路线、景点和预算 Agent 的协作结果；请在不违背实时数据和硬性预算约束的前提下整合）：
${JSON.stringify(agentPlan || {}, null, 2)}

每一行必须是一个独立、完整、可解析的 JSON 对象，不要输出 Markdown、代码围栏或额外解释。按以下顺序输出：
1. 基本信息：
{"type":"meta","city":"目的地城市","budget":总预算整数,"days":旅行天数}
2. 每天必须完整输出 3 个固定时间段，不能省略：
   - morning：上午（约 08:00-12:00）
   - afternoon：中午/下午（约 12:00-18:00，午餐必须放在这个时间段）
   - evening：晚上（约 18:00-21:00）
   只能使用 period 值 morning、afternoon、evening，禁止使用 noon、lunch、midday 或中文时间段名称。
   每个时间段的字段分别输出 field 事件。每个时间段必须输出 5 个字段事件，共 ${days * 3 * 5} 行；一个字段生成完成后立即换行输出：
{"type":"field","day":1,"period":"morning","field":"spot","value":"景点名称"}
{"type":"field","day":1,"period":"morning","field":"ticket","value":35}
{"type":"field","day":1,"period":"morning","field":"duration","value":"3h"}
{"type":"field","day":1,"period":"morning","field":"transport","value":{"from":"酒店/上一站","to":"当前景点","method":"地铁+步行","route":"从XX站乘地铁X号线，在XX站下车，从X号口出站步行约600米","duration":"约35分钟","cost":8}}
{"type":"field","day":1,"period":"morning","field":"meal","value":{"recommendation":"餐饮建议","cost":35}}
3. 交通建议：
{"type":"transport_advice","data":{
    "to_city": "按交通策略选定并计入预算的城际主方案，例如：夜间普快硬卧，经西安中转",
    "to_city_cost": 城际主方案费用整数,
    "within_city": "市内交通方案，例如：地铁为主，短途打车",
    "within_city_cost": 行程内市内交通总费用整数,
    "to_city_alternatives": [
      {"name":"备选路线名称","description":"经停或中转说明","cost":备选路线费用整数}
    ]
}}
4. 预算明细：
{"type":"budget_breakdown","data":{
    "accommodation": 住宿预算,
    "meals": 餐饮预算,
    "tickets": 门票预算,
    "transport": 交通预算,
    "other": 其他预算（购物、应急等）
}}
5. 注意事项：
{"type":"notes","data":[
    "注意事项1（天气/文化/安全等）",
    "注意事项2"
 ]}

请确保：
1. 每天的 morning、afternoon、evening 三个时间段都必须存在；每个时间段都要提供餐饮建议，并写明推荐吃什么和费用。每个时段的交通都必须说明 from、to、method、route、duration、cost；afternoon 的 from 必须是上午景点，evening 的 from 必须是下午景点，不能只写“地铁/步行”。
2. 交通建议需要结合出发地和交通策略。to_city 是唯一的、已选定且计入预算的主方案；低预算时优先普通列车、夜车、硬卧或合理中转，不能默认推荐高铁或飞机。预算充足时优先高铁、飞机等省时方案。去程优先安排上午车次，返程优先安排 18:00 后车次，尽量选择 20:00-21:00 区间并兼顾票价；只有实时结果没有符合时段的车次时才可放宽。可在 to_city_alternatives 中给出 0-2 个备选路线，但必须标明费用，且备选路线不计入预算。
3. 游玩时长统一使用小时单位，格式建议为 2h、3h。
4. 每个景点都包含名称、详细介绍（含门票和开放时间）。
5. budget_breakdown.transport 必须严格等于 to_city_cost + within_city_cost；交通预算包含城际到达和行程内市内交通。预算分配总和不超过总预算；other 仅用于购物、应急等零散支出，不能超过总预算的 10%，住宿、餐饮和门票必须给出合理的实际估算。
6. 交通建议具体、可行。市内交通必须写清线路或道路方向、上下车站/出入口（如适用）和预计耗时。没有实时班次数据时，不得编造车次、起降时间或精确余票；可使用“约”“以地图导航为准”的说明。
7. 注意事项实用、针对当地特点。
8. 如果实时参考数据中提供了 spots，景点名称优先从 spots 的 name 字段选择；天气数据表明降雨时优先安排室内景点。
9. 如果实时参考数据中提供了 railway，交通建议的城际主方案、车次、出发到达时间、历时、席别余票和价格只能引用 railway.outbound 或 railway.inbound 中的真实查询结果；不要编造或使用通用知识中的车次和票价。只要查询结果中存在直达车次，就禁止写“暂无直达”。去程和返程都必须分别核对；交通预算必须按去程票价 + 返程票价 + 市内交通计算，不能只算单程。to_city_alternatives 只能引用查询结果中真实存在的车次或明确返回的中转方案，禁止凭常识编造车次。查询结果无可用车次时，明确说明当天暂无可用车次。
10. 如果实时参考数据中的 spots 非空，所有景点必须逐字从 spots.name 中选择，禁止新增、改写或用附近的学校、幼儿园、住宅、普通广场替代；spots 为空时也只能推荐目的地公开可验证的旅游景点，不能编造地点名称。无法确认的地点不要安排。
11. 每行只输出一个 JSON 对象，严格遵守上述 JSONL 事件格式。
12. 特别重要：所有金额字段（ticket、transport.cost、meal.cost、transport_advice 中的各项 cost）必须输出纯数字（如 35），禁止带“元”“￥”等单位或“约”等前缀，单位由前端统一显示。
13. 特别重要：实际输出时必须使用 field 事件，不要输出 day 或 slot 事件。
14. 每个 field 对象必须压缩在同一行，换行只允许出现在两个事件之间。`)
    ]
  }

  async chat(message, streamCallback, stageCallback) {
    const llm = this.ensureLLM()
    stageCallback?.({ key: 'requirements', label: '需求分析 Agent 正在理解上下文' })
    const messages = [
      new SystemMessage('你是一个专业的旅游规划师，擅长根据用户的需求生成详细的旅行行程。请根据用户的需求生成一份详细的旅游规划。'),
      new HumanMessage(message),
    ]

    try {
      stageCallback?.({ key: 'route', label: '路线规划 Agent 正在组织回答' })
      const stream = await llm.stream(messages)
      let fullResponse = ''
      for await (const chunk of stream) {
        const content = this.extractChunkText(chunk.content)
        if (content.trim() === '') continue
        fullResponse += content
        if (streamCallback) streamCallback(content)
      }
      stageCallback?.({ key: 'spots', label: '景点推荐 Agent 已完成检索' })
      return {
        success: true,
        reply: fullResponse,
      }
    } catch (err) {
      return {
        success: false,
        message: err.message,
      }
    }
  }
}

export default new TravelService()
