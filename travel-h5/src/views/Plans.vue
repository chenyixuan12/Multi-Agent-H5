<template>
  <div class="page">
    <van-nav-bar title="我的规划" left-arrow fixed @click-left="goBack"  safe-area-inset-top/>

    <div class="content">
      <van-empty v-if="plans.length === 0" description="暂无规划方案">
        <van-button type="primary" @click="goHome">去规划</van-button>
      </van-empty>

      <van-cell-group v-else inset>
        <van-swipe-cell v-for="item in plans" :key="item.id" :name="item.id">
          <van-cell
            :title="item.title"
            :label="formatLabel(item)"
            is-link
            @click="viewPlan(item)"
          />
          <template #right>
            <van-button square type="danger" text="删除" class="delete-button" @click="removePlan(item)" />
          </template>
        </van-swipe-cell>
      </van-cell-group>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { getPlans, deletePlan } from '../utils/travelStorage'

const router = useRouter()
const plans = ref([])

const goBack = () => router.back()

const goHome = () => router.push('/')

const formatDate = (dateStr) => {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

const formatTripDates = (plan) => {
  const start = plan?.plan?.start_date
  const end = plan?.plan?.end_date
  const short = (value) => {
    const [y, m, d] = String(value || '').split('-')
    return y && m && d ? `${Number(m)}月${Number(d)}日` : ''
  }
  return start && end ? `${short(start)} ~ ${short(end)}` : ''
}

const formatLabel = (item) => {
  const tripDates = formatTripDates(item)
  return tripDates ? `${tripDates} · ${formatDate(item.createdAt)}` : formatDate(item.createdAt)
}

const viewPlan = (plan) => {
  router.push({
    path: '/detail',
    query: {
      city: plan.city,
      budget: plan.budget,
      days: plan.days,
      planId: plan.id
    }
  })
}

const removePlan = async (plan) => {
  try {
    await showConfirmDialog({
      title: '删除规划',
      message: `确定删除“${plan.title}”吗？删除后无法恢复`,
      confirmButtonColor: '#c85d32',
    })
    plans.value = deletePlan(plan.id)
    showToast('规划已删除')
  } catch {
    // 用户取消删除
  }
}

const loadPlans = () => {
  plans.value = getPlans()
}

onMounted(loadPlans)
onActivated(loadPlans)
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding-top:calc(46px + env(safe-area-inset-top));
  background: transparent;
}
.content {
  padding: 12px;
}
.delete-button {
  height: 100%;
}
</style>
