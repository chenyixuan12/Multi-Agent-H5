// 验证完整链路：getContext 是否能拿到 railway 真实数据
import travelDataService from './src/service/travelDataService.js'

async function main() {
  console.log('=== 测试 travelDataService.getContext ===')
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  console.log(`出发地: 杭州, 目的地: 兰州, 日期: ${tomorrow}`)

  const ctx = await travelDataService.getContext('杭州', '兰州', tomorrow)

  console.log('\n--- context 概览 ---')
  console.log('available:', ctx.available)
  console.log('message:', ctx.message)
  console.log('sources:', ctx.sources)
  console.log('weather:', ctx.weather ? `有(${ctx.weather.forecasts?.length}天)` : '无')
  console.log('spots:', ctx.spots ? `${ctx.spots.length}个` : '无')
  console.log('route:', ctx.route ? '有' : '无')

  console.log('\n--- railway 数据 ---')
  if (ctx.railway) {
    console.log(`fromStation: ${ctx.railway.fromStation}`)
    console.log(`toStation: ${ctx.railway.toStation}`)
    console.log(`trainDate: ${ctx.railway.trainDate}`)
    console.log('result 前 800 字:')
    console.log(ctx.railway.result.slice(0, 800))
  } else {
    console.log('railway 为 null！MCP 服务可能未启动或调用失败')
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('测试失败:', err)
  process.exit(1)
})
