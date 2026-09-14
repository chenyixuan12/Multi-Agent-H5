import 'dotenv/config'
import railway12306Service from './railway12306Service.js'

const AMAP_BASE_URL = 'https://restapi.amap.com'

class TravelDataService {
  constructor() {
    this.apiKey = process.env.AMAP_API_KEY
  }

  async getContext(origin, city, trainDate = new Date().toISOString().slice(0, 10), returnDate = trainDate) {
    const empty = {
      available: false,
      message: '未配置实时数据接口，将使用模型通用知识规划',
      sources: [],
      origin: null,
      destination: null,
      weather: null,
      spots: [],
      route: null,
      railway: null,
    }
    // The Python MCP server keeps one session per client and does not reliably
    // handle concurrent tools/call requests on that session.
    const outbound = await railway12306Service.queryTickets(origin, city, trainDate)
    // Return travel is planned for the evening. Restrict the live query window
    // so the MCP text response is not truncated by early trains. If there is no
    // train after 18:00, fall back to the afternoon window.
    let inbound = await railway12306Service.queryTickets(city, origin, returnDate, {
      earliestStartTime: 18,
      sortFlag: 'startTime',
    })
    const hasTrain = (value) => /\b[A-Z]\d{1,5}\b.*\d{2}:\d{2}/.test(String(value?.result || ''))
    if (!hasTrain(inbound)) {
      inbound = await railway12306Service.queryTickets(city, origin, returnDate, {
        earliestStartTime: 12,
        sortFlag: 'startTime',
      })
    }
    const railway = outbound || inbound ? { outbound, inbound, result: outbound?.result || inbound?.result || '' } : null
    if (!this.apiKey) {
      return {
        ...empty,
        available: Boolean(railway),
        message: railway ? '12306 实时车次数据已接入' : empty.message,
        sources: railway ? ['12306 官方余票/车次查询'] : [],
        railway,
      }
    }

    try {
      const [originResult, destinationResult] = await Promise.allSettled([
        this.geocode(origin),
        this.geocode(city),
      ])
      const originGeo = originResult.status === 'fulfilled' ? originResult.value : null
      const destinationGeo = destinationResult.status === 'fulfilled' ? destinationResult.value : null
      const [weatherResult, spotsResult, routeResult] = await Promise.allSettled([
        this.getWeather(destinationGeo?.adcode),
        this.getSpots(city),
        this.getRoute(originGeo?.location, destinationGeo?.location),
      ])
      const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null
      const spots = spotsResult.status === 'fulfilled' ? spotsResult.value : []
      const route = routeResult.status === 'fulfilled' ? routeResult.value : null
      const available = Boolean(originGeo || destinationGeo || weather || spots.length || route || railway)

      return {
        available,
        message: available ? '实时数据已接入，行程将优先参考 API 数据' : '实时数据接口未返回有效结果',
        sources: [
          '高德地图地理编码',
          '高德天气',
          '高德景点 POI',
          '高德驾车路线',
          ...(railway ? ['12306 官方余票/车次查询'] : []),
        ],
        origin: originGeo,
        destination: destinationGeo,
        weather,
        spots,
        route,
        railway,
      }
    } catch (error) {
      return {
        ...empty,
        available: Boolean(railway),
        message: railway
          ? '高德数据暂不可用，但12306实时车次数据已接入'
          : `实时旅游数据暂不可用，将使用模型通用知识规划（${error.message}）`,
        sources: railway ? ['12306 官方余票/车次查询'] : [],
        railway,
      }
    }
  }

  async request(path, params) {
    const query = new URLSearchParams({
      key: this.apiKey,
      ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')),
    })
    const response = await fetch(`${AMAP_BASE_URL}${path}?${query}`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) throw new Error(`高德接口 HTTP ${response.status}`)
    const payload = await response.json()
    if (payload.status !== '1') throw new Error(payload.info || '高德接口返回失败')
    return payload
  }

  async geocode(address) {
    const payload = await this.request('/v3/geocode/geo', { address })
    const item = payload.geocodes?.[0]
    if (!item) throw new Error(`无法定位地址：${address}`)
    return {
      address: item.formatted_address || address,
      location: item.location,
      adcode: item.adcode,
      city: item.city,
      district: item.district,
    }
  }

  async getWeather(citycode) {
    if (!citycode) return null
    const payload = await this.request('/v3/weather/weatherInfo', {
      city: citycode,
      extensions: 'all',
    })
    return {
      forecasts: (payload.forecasts?.[0]?.casts || []).slice(0, 7).map((item) => ({
        date: item.date,
        week: item.week,
        dayWeather: item.dayweather,
        nightWeather: item.nightweather,
        dayTemp: item.daytemp,
        nightTemp: item.nighttemp,
        dayWind: item.daywind,
        dayPower: item.daypower,
      })),
    }
  }

  async getSpots(city) {
    const payload = await this.request('/v5/place/text', {
      keywords: '热门景点|著名景点|旅游景点|风景名胜|博物馆|公园|历史文化景点',
      types: '110000|140000',
      city,
      citylimit: 'true',
      page_size: '25',
      page_num: '1',
      extensions: 'all',
    })
    return (payload.pois || [])
      .filter((item) => item.name)
      .map((item) => ({
        name: item.name,
        address: item.address,
        location: item.location,
        type: item.type,
        tel: item.tel,
        entrance: item.entrance,
        businessArea: item.business_area,
        // 保留高德原始排序和评分，让景点 Agent 按实时热度判断，而不是代码代替模型选景点。
        rating: item.biz_ext?.rating || item.rating || null,
        popularity: item.biz_ext?.cost || null,
      }))
      .slice(0, 25)
  }

  async verifySpot(name, city) {
    if (!this.apiKey || !name) return { available: false }
    try {
      const payload = await this.request('/v5/place/text', {
        keywords: name,
        region: city,
        city_limit: 'true',
        page_size: '5',
        page_num: '1',
      })
      const normalizeName = (value) => String(value || '')
        .replace(/[\s　]/g, '')
        .replace(/[（(].*?[）)]/g, '')
      // Never treat an unrelated first search result as proof that the model's
      // location exists. Amap text search may return a nearby POI for a typo.
      const requestedName = normalizeName(name)
      const pois = payload.pois || []
      const exact = pois.find((item) => normalizeName(item.name) === requestedName)
      const contained = pois.filter((item) => normalizeName(item.name).includes(requestedName))
      // 同名候选里优先挑高德归类为风景名胜/文化场馆的 POI（仅用于消歧，不限制哪些算景点）
      const scenic = (item) => /^11\d{4}/u.test(String(item.type || '')) || /(风景名胜|博物馆|展览馆|纪念馆|公园|文化场馆)/u.test(`${item.name} ${item.type}`)
      const poi = exact || contained.find(scenic) || contained[0]
      if (!poi) return { available: true, found: false }
      const poiName = String(poi.name || '')
      const nonTourist = /(幼儿园|小学|中学|诊所|医院|公司|银行|住宅|小区|写字楼|酒店|宾馆|加油站|停车场|商场|超市|菜市场|工厂)$/u
      if (nonTourist.test(poiName)) return { available: true, found: false }
      return {
        available: true,
        found: true,
        name: poi.name,
        address: poi.address || '地址信息暂缺',
        location: poi.location,
        type: poi.type,
        tel: poi.tel,
      }
    } catch {
      return { available: false }
    }
  }
  async verifyCandidates(candidates, city) {
    if (!this.apiKey || !Array.isArray(candidates) || !candidates.length) return []
    const results = await Promise.allSettled(
      candidates.map((candidate) => this.verifySpot(candidate?.name, city)),
    )
    return results
      .filter((r) => r.status === 'fulfilled' && r.value?.found)
      .map((r) => ({
        name: r.value.name,
        address: r.value.address,
        location: r.value.location,
        type: r.value.type,
        tel: r.value.tel,
        preferred: true,
      }))
  }
  async verifyPlanSpots(plan, city, knownSpots = []) {
    if (!this.apiKey || !Array.isArray(plan.daily_schedule)) return plan
    const checks = []
    plan.daily_schedule.forEach((day) => {
      ;['morning', 'afternoon', 'evening'].forEach((period) => {
        const item = day[period]
        if (item?.spot) checks.push({ day, period, item })
      })
    })

    await Promise.all(checks.map(async ({ day, period, item }) => {
      // 模型选中的热门景点不受预取列表限制，全部实时核验；
      // 已预取的 POI 在核验失败时兜底保留，避免误删故宫等热门景点
      const known = knownSpots.find((spot) => spot.name === item.spot)
      const poi = await this.verifySpot(item.spot, city)
      if (poi.available && !poi.found && !known) {
        delete day[period]
        return
      }
      if (!poi.found) {
        item.poi = known ? { verified: true, ...known } : { verified: false }
        return
      }
      item.spot = poi.name
      item.poi = { verified: true, ...poi }
    }))

    plan.daily_schedule = plan.daily_schedule.filter((day) => day.morning || day.afternoon || day.evening)
    return plan
  }

  async getRoute(origin, destination) {
    if (!origin || !destination) return null
    const payload = await this.request('/v3/direction/driving', {
      origin,
      destination,
      extensions: 'base',
      strategy: '0',
    })
    const path = payload.route?.paths?.[0]
    if (!path) return null
    return {
      distanceMeters: Number(path.distance),
      durationSeconds: Number(path.duration),
      toll: Number(path.tolls || 0),
    }
  }
}

export default new TravelDataService()
