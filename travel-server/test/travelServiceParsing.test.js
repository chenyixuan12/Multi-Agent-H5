import test from 'node:test'
import assert from 'node:assert/strict'
import travelService from '../src/service/travelService.js'

test('parsePlanResponse preserves a complete non-JSONL plan object', () => {
  const plan = travelService.parsePlanResponse(JSON.stringify({
    city: '太原市',
    budget: 2000,
    days: 1,
    daily_schedule: [{ day: 1, morning: { spot: '晋祠' } }],
    budget_breakdown: { accommodation: 500, meals: 300, tickets: 100, transport: 200, other: 50 },
    notes: ['带伞'],
    transport_advice: { to_city: '铁路', to_city_cost: 150, within_city: '公交', within_city_cost: 50 },
  }))

  assert.equal(plan.daily_schedule.length, 1)
  assert.equal(plan.budget_breakdown.transport, 200)
  assert.deepEqual(plan.notes, ['带伞'])
})

test('ensurePlanCompleteness fills missing sections from specialist results', () => {
  const plan = travelService.ensurePlanCompleteness(
    { transport_advice: { to_city: '铁路', to_city_cost: 300, within_city: '地铁', within_city_cost: 60 } },
    {
      origin: '杭州',
      city: '太原市',
      budget: 2000,
      days: 1,
      travelContext: { spots: [{ name: '晋祠', type: '风景名胜' }] },
      agentPlan: {
        spots: { days: [{ day: 1, spots: [{ name: '晋祠', estimated_ticket: 80 }] }] },
        budget: { allocation: { accommodation: 500, meals: 300, tickets: 80, transport: 360, other: 100 } },
      },
    },
  )

  assert.equal(plan.daily_schedule.length, 1)
  assert.equal(plan.daily_schedule[0].morning.spot, '晋祠')
  assert.equal(plan.budget_breakdown.transport, 360)
  assert.ok(plan.notes.length > 0)
})

test('ensurePlanCompleteness enriches repeated slots and uses most of the budget', () => {
  const plan = travelService.ensurePlanCompleteness(
    {
      daily_schedule: [{
        day: 1,
        morning: { spot: '景点A', transport: { from: '酒店', to: '景点A', method: '地铁/步行', route: '请以当天地图导航为准', cost: 0 }, meal: { recommendation: '当地特色餐饮', cost: 35 } },
        afternoon: { spot: '景点A' },
        evening: { spot: '景点A' },
      }],
      transport_advice: { to_city_cost: 526, within_city_cost: 40 },
      budget_breakdown: { accommodation: 300, meals: 200, tickets: 100, transport: 300, other: 50 },
    },
    {
      city: '兰州',
      budget: 2000,
      days: 1,
      travelContext: { spots: [{ name: '景点A' }, { name: '景点B' }, { name: '景点C' }] },
    },
  )

  const slots = plan.daily_schedule[0]
  assert.notEqual(slots.morning.spot, slots.afternoon.spot)
  assert.notEqual(slots.afternoon.spot, slots.evening.spot)
  assert.match(slots.morning.transport.route, /从.*出发前往/)
  assert.ok(slots.morning.meal.recommendation.length > 0)
  assert.match(slots.morning.meal.recommendation, /特色菜|餐馆菜单/)
  const total = Object.values(plan.budget_breakdown).reduce((sum, value) => sum + value, 0)
  assert.ok(total <= 2000)
  assert.ok(total >= 1900)
})

test('addDays shifts YYYY-MM-DD without timezone drift', () => {
  assert.equal(travelService.addDays('2026-08-29', 1), '2026-08-30')
  assert.equal(travelService.addDays('2026-08-29', 2), '2026-08-31')
  assert.equal(travelService.addDays('2026-08-31', 1), '2026-09-01')
  assert.equal(travelService.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(travelService.addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(travelService.addDays(null, 1), null)
})

test('extractRailwayOption prefers an available second-class seat over standing room', () => {
  const railwayText = [
    'D100 08:54-10:24',
    '- 无座：有票 33元',
    '- 二等座：有票 73元',
    'Y701 08:53-11:32',
    '硬座: 有票 29.5元',
  ].join('\n')

  assert.deepEqual(travelService.extractRailwayOption(railwayText, 'comfort'), {
    train: 'D100',
    departure: '08:54',
    arrival: '10:24',
    seat: '二等座',
    price: 73,
  })
  assert.equal(travelService.extractRailwayOption('Y701 08:53-11:32\n- 硬座：有票 29.5元', 'second_class'), null)
})

test('extractRailwayOption prefers an evening return train and balances price', () => {
  const railwayText = [
    'D100 18:00-19:00',
    '- 二等座：有票 50元',
    'G123 20:00-21:00',
    '- 二等座：剩余 20张票 90元',
    'G124 20:30-21:30',
    '- 二等座：有票 120元',
  ].join('\n')

  const option = travelService.extractRailwayOption(railwayText, 'comfort', {
    preferredDepartureFrom: '18:00',
    targetDepartureFrom: '20:00',
    targetDepartureTo: '21:00',
  })
  assert.equal(option.train, 'G123')
  assert.equal(option.departure, '20:00')
  assert.equal(option.seat, '二等座')
})

test('normalizeRailwayAdvice uses second-class seats and an evening return', () => {
  const railway = {
    outbound: { result: [
      'D100 08:54-10:24',
      '- 无座：有票 33元',
      '- 二等座：有票 73元',
    ].join('\n') },
    inbound: { result: [
      'Y701 08:53-11:32',
      '- 硬座：有票 29.5元',
      'G123 20:30-21:30',
      '- 二等座：有票 90元',
    ].join('\n') },
  }

  const plan = travelService.normalizeRailwayAdvice({ transport_advice: {} }, railway, 900, 2)
  assert.match(plan.transport_advice.to_city, /二等座73元/)
  assert.match(plan.transport_advice.to_city, /G123\（20:30-21:30，二等座90元\）/)
  assert.equal(plan.transport_advice.to_city_cost, 163)
})

test('ensurePlanCompleteness stamps each day with a date starting from startDate', () => {
  const plan = travelService.ensurePlanCompleteness(
    {
      daily_schedule: [
        { day: 2, morning: { spot: '景点B' } },
        { day: 1, morning: { spot: '景点A' } },
      ],
      transport_advice: { to_city_cost: 200, within_city_cost: 40 },
      budget_breakdown: { accommodation: 300, meals: 200, tickets: 100, transport: 300, other: 50 },
    },
    {
      city: '太原市',
      budget: 1500,
      days: 2,
      startDate: '2026-08-30',
      travelContext: { spots: [{ name: '景点A' }, { name: '景点B' }, { name: '景点C' }] },
    },
  )

  assert.equal(plan.daily_schedule.length, 2)
  assert.equal(plan.daily_schedule[0].day, 1)
  assert.equal(plan.daily_schedule[0].date, '2026-08-30')
  assert.equal(plan.daily_schedule[1].day, 2)
  assert.equal(plan.daily_schedule[1].date, '2026-08-31')
})
