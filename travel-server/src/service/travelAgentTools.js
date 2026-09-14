import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import travelDataService from './travelDataService.js'
import validationService from './travelValidationService.js'

function json(value) {
  return JSON.stringify(value ?? null)
}

const ALL_TOOL_FACTORIES = {
  get_weather: ({ dataService }) => tool(
    async ({ citycode }) => json(await dataService.getWeather(citycode)),
    {
      name: 'get_weather',
      description: '查询目的地未来天气。citycode 应使用地理编码返回的 adcode。',
      schema: z.object({ citycode: z.string().min(1) }),
    },
  ),
  search_spots: ({ dataService }) => tool(
    async ({ city }) => json(await dataService.getSpots(city)),
    {
      name: 'search_spots',
      description: '搜索目的地的真实景点、博物馆、公园和其他 POI。',
      schema: z.object({ city: z.string().min(1) }),
    },
  ),
  get_route: ({ dataService }) => tool(
    async ({ origin, destination }) => json(await dataService.getRoute(origin, destination)),
    {
      name: 'get_route',
      description: '查询两个高德坐标之间的驾车距离、时长和费用。坐标格式为 经度,纬度。',
      schema: z.object({ origin: z.string().min(3), destination: z.string().min(3) }),
    },
  ),
  verify_spot: ({ dataService }) => tool(
    async ({ name, city }) => json(await dataService.verifySpot(name, city)),
    {
      name: 'verify_spot',
      description: '核验景点名称是否存在于目的地城市的真实 POI 数据中。',
      schema: z.object({ name: z.string().min(1), city: z.string().min(1) }),
    },
  ),
  validate_budget: () => tool(
    async ({ plan, budget }) => json(validationService.calculateBudget(JSON.parse(plan), budget)),
    {
      name: 'validate_budget',
      description: '计算行程费用并检查是否超出预算。plan 必须是 JSON 字符串。',
      schema: z.object({ plan: z.string().min(2), budget: z.number().positive() }),
    },
  ),
  validate_plan: ({ dataService, context }) => tool(
    async ({ plan, budget }) => json(await validationService.validatePlan(JSON.parse(plan), {
      budget,
      weather: context.weather,
      travelDataService: dataService,
    })),
    {
      name: 'validate_plan',
      description: '综合检查行程预算、每日景点路线和天气适配性。plan 必须是 JSON 字符串。',
      schema: z.object({ plan: z.string().min(2), budget: z.number().positive() }),
    },
  ),
}

export function createTravelTools({ dataService = travelDataService, context = {}, names } = {}) {
  const factories = names
    ? Object.fromEntries(Object.entries(ALL_TOOL_FACTORIES).filter(([name]) => names.includes(name)))
    : ALL_TOOL_FACTORIES
  return Object.values(factories).map((factory) => factory({ dataService, context }))
}

export default createTravelTools
