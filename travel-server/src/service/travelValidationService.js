const PERIODS = ['morning', 'afternoon', 'evening']
const INDOOR_WORDS = ['博物馆', '美术馆', '艺术馆', '科技馆', '展览馆', '图书馆', '商场', '购物中心', '水族馆', '剧院', '影院', '室内']
const BAD_WEATHER_WORDS = ['雨', '雷', '雪', '台风', '暴雨', '大风', '冰雹']

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function getAdviceCost(advice, key) {
  if (!advice || typeof advice !== 'object') return 0
  const directCost = advice[`${key}_cost`]
  if (directCost !== undefined) return toNumber(directCost)
  return toNumber(advice[key]?.cost)
}

export function calculateTransportAdviceBudget(transportAdvice) {
  const toCity = getAdviceCost(transportAdvice, 'to_city')
  const withinCity = getAdviceCost(transportAdvice, 'within_city')
  return { toCity, withinCity, total: toCity + withinCity }
}

export function reconcileTransportBudget(plan, budget) {
  const adviceBudget = calculateTransportAdviceBudget(plan?.transport_advice)
  const breakdown = plan?.budget_breakdown
  if (!adviceBudget.total || !breakdown || typeof breakdown !== 'object') return plan

  const normalizedBreakdown = { ...breakdown, transport: adviceBudget.total }
  const limit = toNumber(budget)

  // Prevent the catch-all category from hiding an under-specified plan.
  // Reallocate excess to the explicit daily categories so the breakdown remains useful.
  if (limit > 0) {
    const otherLimit = Math.round(limit * 0.1)
    const currentOther = toNumber(normalizedBreakdown.other)
    if (currentOther > otherLimit) {
      const excessOther = currentOther - otherLimit
      normalizedBreakdown.other = otherLimit
      const keys = ['accommodation', 'meals', 'tickets']
      const weights = keys.map((key) => Math.max(1, toNumber(normalizedBreakdown[key])))
      const weightTotal = weights.reduce((sum, value) => sum + value, 0)
      keys.forEach((key, index) => {
        normalizedBreakdown[key] = toNumber(normalizedBreakdown[key])
          + Math.round(excessOther * weights[index] / weightTotal)
      })
    }
  }

  let excess = Math.max(0, Object.values(normalizedBreakdown)
    .reduce((sum, value) => sum + toNumber(value), 0) - limit)

  // Keep the selected transport cost intact; contingency spending is the first allocation to rebalance.
  for (const key of ['other', 'meals', 'tickets', 'accommodation']) {
    if (!excess) break
    const current = toNumber(normalizedBreakdown[key])
    const reduction = Math.min(current, excess)
    normalizedBreakdown[key] = current - reduction
    excess -= reduction
  }

  return { ...plan, budget_breakdown: normalizedBreakdown }
}

function costOfSlot(slot) {
  if (!slot || typeof slot !== 'object') return 0
  return toNumber(slot.ticket) + toNumber(slot.transport?.cost) + toNumber(slot.meal?.cost)
}

function calculatePlanBudget(plan) {
  const breakdown = plan?.budget_breakdown
  if (breakdown && typeof breakdown === 'object') {
    const total = Object.values(breakdown).reduce((sum, value) => sum + toNumber(value), 0)
    if (total > 0) return { total, source: 'budget_breakdown', breakdown }
  }
  const total = (plan?.daily_schedule || []).reduce((sum, day) => (
    sum + PERIODS.reduce((daySum, period) => daySum + costOfSlot(day?.[period]), 0)
  ), 0)
  return { total, source: 'slot_costs', breakdown: null }
}

function isBadWeather(forecast) {
  if (!forecast) return false
  const text = `${forecast.dayWeather || ''}${forecast.nightWeather || ''}`
  return BAD_WEATHER_WORDS.some((word) => text.includes(word))
}

function isIndoor(slot) {
  const text = `${slot?.spot || ''}${slot?.description || ''}${slot?.poi?.type || ''}`
  return INDOOR_WORDS.some((word) => text.includes(word))
}

export function calculateBudget(plan, budget) {
  const actual = calculatePlanBudget(plan)
  const limit = toNumber(budget)
  const over = limit > 0 && actual.total > limit
  return {
    ...actual,
    limit,
    over,
    overAmount: over ? actual.total - limit : 0,
    status: over ? 'over_budget' : 'within_budget',
  }
}

export async function validateDailyRoutes(plan, travelDataService) {
  const days = []
  const issues = []
  for (const day of plan?.daily_schedule || []) {
    const legs = []
    let totalMinutes = 0
    for (let index = 0; index < PERIODS.length - 1; index += 1) {
      const from = day?.[PERIODS[index]]?.poi?.location
      const to = day?.[PERIODS[index + 1]]?.poi?.location
      if (!from || !to || !travelDataService?.getRoute) continue
      try {
        const route = await travelDataService.getRoute(from, to)
        if (!route) continue
        const minutes = Math.round((route.durationSeconds || 0) / 60)
        totalMinutes += minutes
        legs.push({ from: PERIODS[index], to: PERIODS[index + 1], ...route, minutes })
      } catch (error) {
        legs.push({ from: PERIODS[index], to: PERIODS[index + 1], available: false, message: error.message })
      }
    }
    const feasible = totalMinutes <= 240 || legs.length === 0
    days.push({ day: day.day, feasible, totalMinutes, legs })
    if (!feasible) issues.push({ type: 'route', day: day.day, message: `第${day.day}天景点间驾车预计${totalMinutes}分钟，路线过于紧凑` })
  }
  return { days, issues, status: issues.length ? 'needs_replan' : 'ok' }
}

export function validateWeather(plan, weather) {
  const affectedDays = []
  const issues = []
  for (const day of plan?.daily_schedule || []) {
    const forecasts = weather?.forecasts || []
    const forecast = forecasts[Number(day.day) - 1] || forecasts[0]
    if (!isBadWeather(forecast)) continue
    const outdoorPeriods = PERIODS.filter((period) => day?.[period]?.spot && !isIndoor(day[period]))
    if (!outdoorPeriods.length) continue
    affectedDays.push({ day: day.day, forecast, periods: outdoorPeriods })
    issues.push({ type: 'weather', day: day.day, periods: outdoorPeriods, message: `第${day.day}天可能有${forecast.dayWeather || forecast.nightWeather || '恶劣天气'}，建议替换为室内景点` })
  }
  return { affectedDays, issues, status: issues.length ? 'needs_replan' : 'ok' }
}

export async function validatePlan(plan, { budget, weather, travelDataService } = {}) {
  const budgetResult = calculateBudget(plan, budget)
  const routeResult = await validateDailyRoutes(plan, travelDataService)
  const weatherResult = validateWeather(plan, weather)
  const issues = [
    ...(budgetResult.over ? [{ type: 'budget', message: `行程预计超预算${budgetResult.overAmount}元` }] : []),
    ...routeResult.issues,
    ...weatherResult.issues,
  ]
  return {
    valid: issues.length === 0,
    needsReplan: issues.length > 0,
    issues,
    budget: budgetResult,
    routes: routeResult,
    weather: weatherResult,
  }
}

export default { calculateBudget, calculateTransportAdviceBudget, reconcileTransportBudget, validateDailyRoutes, validateWeather, validatePlan }
