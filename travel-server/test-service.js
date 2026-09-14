// 直接测试改造后的 railway12306Service
// 运行：node test-service.js

import railwayService from './src/service/railway12306Service.js'

async function main() {
  console.log('=== 测试 railway12306Service.queryTickets ===')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dateStr = tomorrow.toISOString().slice(0, 10)

  const result = await railwayService.queryTickets('杭州', '兰州', dateStr, {
    limitedNum: 3,
    sortFlag: 'startTime',
  })

  if (result) {
    console.log(`查询成功: ${result.fromStation} → ${result.toStation} (${result.trainDate})`)
    console.log('---')
    console.log(result.result)
  } else {
    console.log('查询返回 null，请检查 12306-mcp 服务是否启动')
  }

  console.log('\n=== 测试 railway12306Service.getStationsInCity ===')
  const stations = await railwayService.getStationsInCity('杭州')
  if (stations) {
    console.log(stations.result)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('测试失败:', err)
  process.exit(1)
})
