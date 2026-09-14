<template>
  <div ref="chartRef" class="budget-chart" aria-label="预算分布图"></div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({ budget: { type: Object, default: () => ({}) } })

const chartRef = ref(null)
let chart
let resizeObserver

const labels = {
  accommodation: '住宿',
  meals: '餐饮',
  tickets: '门票',
  transport: '交通',
  other: '其他',
}

const getData = () => Object.entries(labels)
  .map(([key, name]) => {
    const raw = props.budget?.[key]
    const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0)
    return { name, value }
  })
  .filter(({ value }) => value > 0)

const render = () => {
  if (!chart) return

  const data = getData()
  chart.setOption({
    color: ['#66734b', '#dc7b46', '#9aa878', '#d9aa63', '#9b8d73'],
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { bottom: 0, left: 'center', textStyle: { fontSize: 12, color: '#4d5b3d' } },
    graphic: data.length ? [] : [{
      type: 'text',
      left: 'center',
      top: 'middle',
      style: { text: '暂无预算数据', fill: '#7d8071', fontSize: 14 },
    }],
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '42%'],
      label: { formatter: '{b}\n¥{c}', fontSize: 12 },
      data,
    }],
  }, true)
  chart.resize()
}

const resizeChart = () => chart?.resize()

onMounted(async () => {
  await nextTick()
  chart = echarts.init(chartRef.value)
  resizeObserver = new ResizeObserver(resizeChart)
  resizeObserver.observe(chartRef.value)
  render()
  window.addEventListener('resize', resizeChart)
})

watch(() => props.budget, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart)
  resizeObserver?.disconnect()
  chart?.dispose()
})
</script>

<style scoped>
.budget-chart {
  width: 100%;
  height: 280px;
}
</style>
