<template>
  <div class="budget-table">
    <div class="table-header">
      <van-icon name="wallet" />
      <span>预算明细</span>
    </div>
    
    <div class="table-content">
      <div class="table-row" v-for="(label, key) in labels" :key="key">
        <div class="row-label">{{ label }}</div>
        <div class="row-value">¥{{ budget[key]?.toLocaleString() || 0 }}</div>
      </div>
      <div v-if="transportAdviceBudget.total" class="transport-breakdown">
        主方案含城际 ¥{{ transportAdviceBudget.toCity.toLocaleString() }} + 市内 ¥{{ transportAdviceBudget.withinCity.toLocaleString() }}
      </div>
    </div>
    
    <div class="table-footer">
      <div class="total-label">总计</div>
      <div class="total-value">¥{{ totalBudget.toLocaleString() }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Icon } from 'vant'

const props = defineProps({
  budget: {
    type: Object,
    required: true
  },
  transportAdvice: {
    type: Object,
    default: null
  }
})

const labels = {
  accommodation: '住宿',
  meals: '餐饮',
  tickets: '门票',
  transport: '交通',
  other: '其他'
}

const totalBudget = computed(() => {
  return Object.keys(labels).reduce((sum, key) => {
    return sum + toNumber(props.budget[key])
  }, 0)
})

const toNumber = (value) => {
  const match = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

const transportAdviceBudget = computed(() => {
  const advice = props.transportAdvice
  const toCity = toNumber(advice?.to_city_cost ?? advice?.to_city?.cost)
  const withinCity = toNumber(advice?.within_city_cost ?? advice?.within_city?.cost)
  return { toCity, withinCity, total: toCity + withinCity }
})
</script>

<style scoped>
.budget-table {
  background-color: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 10px;
  overflow: hidden;
  box-shadow: var(--card-shadow);
}

.table-header {
  display: flex;
  align-items: center;
  padding: 16px;
  background: var(--olive-800);
  color: var(--paper);
}

.table-header van-icon {
  margin-right: 8px;
  font-size: 18px;
}

.table-header span {
  font-size: 16px;
  font-weight: 600;
}

.table-content {
  padding: 0 16px;
}

.table-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px dashed var(--line);
}

.table-row:last-child {
  border-bottom: none;
}

.transport-breakdown {
  padding: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}

.row-label {
  font-size: 14px;
  color: var(--muted);
}

.row-value {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}

.table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background-color: var(--sand-100);
  border-top: 1px solid var(--line);
}

.total-label {
  font-size: 14px;
  color: var(--muted);
}

.total-value {
  font-size: 18px;
  color: var(--orange-600);
  font-weight: 600;
}
</style>
