import 'dotenv/config'

/**
 * 12306 MCP 服务客户端（HTTP 模式）
 *
 * 对接 mcp-server-12306（Python 版）Streamable HTTP 服务：
 *   mcp-12306
 *
 * 通过 MCP Streamable HTTP 协议调用工具，无需额外 SDK 依赖。
 * 暴露的核心工具：get-tickets（余票查询）、get-train-route-stations（经停站）等。
 */
class Railway12306Service {
  constructor() {
    this.mcpUrl = process.env.RAILWAY_MCP_URL || 'http://localhost:8000/mcp'
    this.timeout = Number(process.env.RAILWAY_12306_TIMEOUT || 25000)
    this.nextRequestId = 1
    this.initialized = false
    this.initPromise = null
    this.sessionId = null
    this.tools = new Set()
  }

  isConfigured() {
    return process.env.RAILWAY_12306_ENABLED !== 'false'
  }

  async ensureInitialized() {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._initialize()
    try {
      await this.initPromise
      this.initialized = true
    } finally {
      this.initPromise = null
    }
  }

  async _initialize() {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'travel-agent', version: '1.0.0' },
    })
    // initialized 是通知，不需要等待响应
    await this.notify('notifications/initialized', {})
    try {
      const listed = await this.request('tools/list', {})
      this.tools = new Set((listed?.tools || []).map((item) => item.name))
    } catch (error) {
      console.warn(`[12306] 工具列表获取失败：${error.message}`)
    }
  }

  /**
   * 发送 MCP JSON-RPC 请求（HTTP POST）
   */
  async request(method, params) {
    const id = this.nextRequestId++
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      }
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId
      }

      const response = await fetch(this.mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      })

      // 尝试从响应头获取 session id
      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId) this.sessionId = sessionId

      const text = await response.text()
      const message = this.parseResponse(text)

      if (message.error) {
        throw new Error(message.error.message || '12306 MCP 请求失败')
      }
      return message.result
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('12306 查询超时')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 解析 MCP 响应：兼容纯 JSON 和 SSE（data: ...）两种格式
   */
  parseResponse(text) {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('MCP 响应为空')

    // 1. 直接是 JSON
    try {
      return JSON.parse(trimmed)
    } catch {
      // 不是纯 JSON，继续尝试 SSE 格式
    }

    // 2. SSE 格式：取最后一个 data: 行
    const lines = trimmed.split(/\r?\n/)
    let lastData = null
    for (const line of lines) {
      if (line.startsWith('data:')) {
        lastData = line.slice(5).trim()
      }
    }
    if (lastData) {
      try {
        return JSON.parse(lastData)
      } catch {
        throw new Error(`无法解析 SSE 数据: ${lastData.slice(0, 200)}`)
      }
    }

    throw new Error(`无法解析 MCP 响应: ${trimmed.slice(0, 200)}`)
  }

  /**
   * 发送 MCP 通知（不需要 id 和响应）
   */
  async notify(method, params) {
    const headers = { 'Content-Type': 'application/json' }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    await fetch(this.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(() => {})
  }

  /**
   * 查询余票（核心方法）
   *
   * @param {string} fromStation 出发站中文名或 station_code，如 "杭州"、"杭州东"
   * @param {string} toStation   到达站中文名或 station_code
   * @param {string} trainDate   查询日期，格式 yyyy-MM-dd
   * @param {object} [options]   可选筛选条件
   * @param {string} [options.trainFilterFlags] 车次筛选，如 "G" 仅高铁，"GD" 高铁+动车
   * @param {string} [options.sortFlag]          排序：startTime / arriveTime / duration
   * @param {number} [options.limitedNum]        返回条数限制，0 表示不限制
   * @param {string} [options.format]            返回格式：text / csv / json
   * @returns {Promise<{trainDate:string, fromStation:string, toStation:string, result:string}|null>}
   */
  async queryTickets(fromStation, toStation, trainDate, options = {}) {
    if (!this.isConfigured()) return null
    try {
      await this.ensureInitialized()

      const resolved = await this.resolveStations(fromStation, toStation)
      const legacy = this.tools.has('get-tickets') || !this.tools.has('query-tickets')
      const result = await this.request('tools/call', {
        name: legacy ? 'get-tickets' : 'query-tickets',
        arguments: legacy
          ? {
              date: trainDate,
              fromStation: resolved.from,
              toStation: resolved.to,
              format: options.format || 'text',
              limitedNum: options.limitedNum ?? 0,
              trainFilterFlags: options.trainFilterFlags || '',
              earliestStartTime: options.earliestStartTime ?? 0,
              latestStartTime: options.latestStartTime ?? 24,
              sortFlag: options.sortFlag || '',
              sortReverse: options.sortReverse ?? false,
            }
          : { train_date: trainDate, from_station: resolved.from, to_station: resolved.to },
      })

      const text = result?.content?.find((item) => item.type === 'text')?.text || ''
      return { trainDate, fromStation: resolved.from, toStation: resolved.to, result: text.slice(0, 12000) }
    } catch (error) {
      console.warn(`[12306] 余票查询失败：${error.message}`)
      return null
    }
  }

  /**
   * 查询列车经停站
   *
   * @param {string} trainCode  车次，如 "G1874"
   * @param {string} departDate 出发日期，格式 yyyy-MM-dd
   * @param {object} [options]
   * @param {string} [options.format] text / json
   */
  async getTrainRouteStations(trainCode, departDate, options = {}) {
    if (!this.isConfigured()) return null
    try {
      await this.ensureInitialized()
      const result = await this.request('tools/call', {
        name: 'get-train-route-stations',
        arguments: {
          trainCode,
          departDate,
          format: options.format || 'text',
        },
      })
      const text = result?.content?.find((item) => item.type === 'text')?.text || ''
      return { trainCode, departDate, result: text.slice(0, 12000) }
    } catch (error) {
      console.warn(`[12306] 经停站查询失败：${error.message}`)
      return null
    }
  }

  /**
   * 查询城市下所有火车站
   * @param {string} city 中文城市名，如 "杭州"
   */
  async getStationsInCity(city) {
    if (!this.isConfigured()) return null
    try {
      await this.ensureInitialized()
      const normalizedCity = this.normalizeCityName(city)
      const result = await this.request('tools/call', {
        name: this.tools.has('search-stations') ? 'search-stations' : 'get-stations-code-in-city',
        arguments: this.tools.has('search-stations') ? { query: normalizedCity } : { city: normalizedCity },
      })
      const text = result?.content?.find((item) => item.type === 'text')?.text || ''
      return { city, result: text }
    } catch (error) {
      console.warn(`[12306] 车站查询失败：${error.message}`)
      return null
    }
  }

  async resolveStations(fromStation, toStation) {
    const from = await this.searchStation(fromStation)
    const to = await this.searchStation(toStation)
    return { from: from || fromStation, to: to || toStation }
  }

  async searchStation(query) {
    await this.ensureInitialized()
    const normalizedQuery = this.normalizeCityName(query)
    // A caller may already provide a 12306 telecode.
    if (/^[A-Z0-9]{2,8}$/.test(String(query).trim())) return String(query).trim().toUpperCase()
    const legacy = this.tools.has('get-stations-code-in-city')
    const result = await this.request('tools/call', {
      name: legacy ? 'get-stations-code-in-city' : 'search-stations',
      arguments: legacy ? { city: normalizedQuery } : { query: normalizedQuery },
    })
    const text = result?.content?.find((item) => item.type === 'text')?.text || ''
    const parsed = this.parseStationCandidates(text)
    const exact = parsed.find((item) => item.name === normalizedQuery || item.name === `${normalizedQuery}站`)
    return exact?.code || parsed[0]?.code || parsed[0]?.name || null
  }

  normalizeCityName(value) {
    const text = String(value || '').trim()
    // The MCP station directory indexes city names without administrative suffixes.
    return text.replace(/(?:市|地区|自治州|盟)$/u, '') || text
  }

  parseStationText(text) {
    return this.parseStationCandidates(text).map((item) => item.code || item.name)
  }

  parseStationCandidates(text) {
    if (!text) return []
    try {
      const value = JSON.parse(text)
      const rows = Array.isArray(value) ? value : value.stations || value.data || []
      return rows.map((row) => typeof row === 'string'
        ? { name: row, code: row }
        : { name: row.name || row.station_name, code: row.code || row.station_code || row.stationCode })
        .filter((item) => item.name || item.code)
    } catch {
      return text.split(/\r?\n/)
        .map((line) => line.replace(/^[-*\d.、\s]+/, '').split(/[|,，：:]/)[0].trim())
        .filter((line) => line && !/未找到|没有|station/i.test(line))
        .map((line) => ({ name: line, code: line }))
    }
  }
}

export default new Railway12306Service()
