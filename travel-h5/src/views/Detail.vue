<template>
    <van-nav-bar
  :title="formData.origin + '→'+formData.city + '行程规划'"
  left-text="返回"
  left-arrow
  @click-left="onClickLeft"
  fixed
  safe-area-inset-top
/>
      <div class="page-content">
         <!-- Agent 协作进度：SSE 流式展示多 Agent 规划过程 -->
         <div v-if="isLoading" class="card-container agent-progress-card">
            <div class="agent-progress-header">
               <div class="agent-progress-title">
                  <van-icon name="shield-o" />
                  <span>智能行程规划中</span>
               </div>
               <van-loading size="16px" type="circular" color="var(--orange-600)" />
            </div>
            <div class="agent-step-list">
               <div v-for="step in agentSteps" :key="step.key" class="agent-step-item" :class="step.status">
                  <span class="agent-step-dot">
                     <van-icon v-if="step.status === 'completed'" name="success" class="step-icon done" />
                     <van-icon v-else-if="step.status === 'failed'" name="close" class="step-icon failed" />
                     <van-loading v-else-if="step.status === 'running'" size="14px" type="spinner" class="step-icon running" />
                     <span v-else class="step-icon pending"></span>
                  </span>
                  <span class="agent-step-label">{{ step.label }}</span>
                  <span v-if="step.status === 'running'" class="agent-step-status running">执行中</span>
                  <span v-else-if="step.status === 'completed'" class="agent-step-status done">完成</span>
                  <span v-else-if="step.status === 'failed'" class="agent-step-status failed">失败</span>
               </div>
            </div>
            <div v-if="currentActivity" class="agent-current-activity">
               <van-icon name="underway-o" />
               <span>{{ currentActivity }}</span>
            </div>
            <div class="stream-progress">{{ progressMessage }}</div>
         </div>
         <div v-if="errorMsg && !planHasContent" class="error-container">
            
            <van-empty :description="errorMsg" >
                 <van-button type="primary" @click="fetchTripData">重试</van-button>
            </van-empty>
         </div>
         <div v-if="errorMsg && planHasContent" class="error-banner">
            <van-icon name="warning-o" />
            <span>{{ errorMsg }}</span>
         </div>
         <template v-if="tripData && tripData.status === 200">
            <!-- 第一部分 -->
             <div class="card-container trip-summary">
                  <div class="trip-header">
                      <h2>{{formData.city}}·{{ formData.days }}天行程</h2>
                      <div class="trip-budget">预算：{{ formData.budget }}元</div>
                  </div>
                  <div v-if="tripDateRange" class="trip-dates">出行日期：{{ tripDateRange }}</div>
                  <div v-if="isLoading" class="stream-progress">{{ progressMessage }}</div>
             </div>
             <div v-if="weatherForecasts.length" class="card-container realtime-card">
                  <div class="realtime-title">实时天气</div>
                  <div class="weather-list">
                    <div v-for="forecast in weatherForecasts" :key="forecast.date" class="weather-item">
                      <span>{{ forecast.date }}</span>
                      <span>{{ forecast.dayWeather }}</span>
                      <span>{{ forecast.nightTemp }}-{{ forecast.dayTemp }}℃</span>
                    </div>
                  </div>
                  <div class="data-sources">来源：{{ realtimeContext.sources.join('、') }} · 更新于 {{ formatFetchedAt(realtimeContext.fetchedAt) }}</div>
             </div>
             <!-- 第二部分 -->
              <div v-if="tripData.data.daily_schedule?.length" class="card-container itinerary-card">
                  <van-collapse v-model="activeDays">
                    <van-collapse-item v-for="day in tripData.data.daily_schedule" 
                    :key="day.day" 
                    :title="dayTitle(day)"
                    :name="day.day"
                    >
                    <div class="day-schedule">
                        <div v-if="day.morning && day.morning.spot" class="schedule-slot">
                            <spotItem :spot="day.morning" :city="formData.city" time="morning" />
                        </div>
                        <div v-else-if="isLoading && day.morning" class="schedule-slot slot-streaming">
                            <span class="slot-streaming-text">上午行程生成中…</span>
                        </div>
                        <div v-if="day.afternoon && day.afternoon.spot" class="schedule-slot">
                            <spotItem :spot="day.afternoon" :city="formData.city" time="afternoon" />
                        </div>
                        <div v-else-if="isLoading && day.afternoon" class="schedule-slot slot-streaming">
                            <span class="slot-streaming-text">下午行程生成中…</span>
                        </div>
                        <div v-if="day.evening && day.evening.spot" class="schedule-slot">
                            <spotItem :spot="day.evening" :city="formData.city" time="evening" />
                        </div>
                        <div v-else-if="isLoading && day.evening" class="schedule-slot slot-streaming">
                            <span class="slot-streaming-text">晚上行程生成中…</span>
                        </div>
                    </div>
                    </van-collapse-item>
                </van-collapse>
              </div>
              <!-- 第三部分 -->
               <div v-if="tripData.data.budget_breakdown" class="card-container">
                  <BudgetTable :budget="tripData.data.budget_breakdown" :transport-advice="tripData.data.transport_advice" />
               </div>
               <div v-if="tripData.data.budget_breakdown" class="card-container">
                  <div class="section-title">预算分布分析</div>
                  <BudgetChart v-if="showBudgetChart" :budget="tripData.data.budget_breakdown" />
                  <div v-else class="budget-chart-placeholder" aria-hidden="true"></div>
               </div>
               <!-- 第四部分 -->
               <div v-if="tripData.data.notes?.length" class="card-container">
                  <ChatBubble :notes="tripData.data.notes" />
               </div>
               <!-- 第五部分 -->
               <div v-if="tripData.data.transport_advice" class="transport-card">
  <div class="transport-header">
    <van-icon name="navigation" />
    <span>交通建议</span>
  </div>
  <div class="transport-content">
    <div class="transport-item">
      <span class="transport-label">城市间：</span>
      <span class="transport-value">{{ transportAdviceText(tripData.data.transport_advice, 'to_city') }}</span>
    </div>
    <div class="transport-item">
      <span class="transport-label">城市内：</span>
      <span class="transport-value">{{ transportAdviceText(tripData.data.transport_advice, 'within_city') }}</span>
    </div>
    <div v-for="(alternative, index) in transportAlternatives" :key="index" class="transport-item transport-alternative">
      <span class="transport-label">备选路线：</span>
      <span class="transport-value">{{ transportAlternativeText(alternative) }}</span>
    </div>
  </div>
               </div>
               <!-- 跳转AI聊天 -->
                 <div class="chat-button-container">
                   <van-button type="primary" @click="handleChatClick">咨询AI助手</van-button>
                 </div>
         </template>
      </div>
     
</template>
<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter,useRoute } from 'vue-router'
import { fetchStream } from '../utils/request'
import { savePlan, getPlanById } from '../utils/travelStorage'
import { showToast } from 'vant'
import ChatBubble from '../components/ChatBubble.vue'
import spotItem from '../components/spotItem.vue'
import BudgetTable from '../components/BudgetTable.vue'
import { useTravelStore } from '../stores/travel'

// ECharts is large; load it after the itinerary has been painted.
const BudgetChart = defineAsyncComponent(() => import('../components/BudgetChart.vue'))


const router = useRouter()
const route = useRoute()
const travelStore = useTravelStore()
const formData = reactive({
      origin:'',
      city:'',
      budget:null,
      days:null
})
const isLoading = ref(true)
const errorMsg = ref('')
const tripData = ref(null)
const showBudgetChart = ref(false)
const progressMessage = ref('正在连接规划服务...')
const activeDays = ref([1])
const realtimeContext = ref({ weather: null, sources: [], fetchedAt: '' })
// SSE 流式渲染状态：Agent 协作进度时间线 + 当前实时活动
const agentSteps = ref([])
const currentActivity = ref('')

const AGENT_STEP_META = {
    requirements: { label: '需求分析 Agent', running: '需求分析 Agent 正在拆解旅行约束', done: '需求分析完成' },
    route: { label: '路线规划 Agent', running: '路线规划 Agent 正在安排每日动线', done: '路线规划完成' },
    spots: { label: '景点筛选 Agent', running: '景点筛选 Agent 正在核验候选景点', done: '景点筛选完成' },
    candidates: { label: '地标候选 Agent', running: '地标候选 Agent 正在收集必去地标', done: '地标候选完成' },
    budget: { label: '预算评估 Agent', running: '预算评估 Agent 正在分配费用', done: '预算评估完成' },
    synthesis: { label: '行程整合 Agent', running: '行程整合 Agent 正在生成最终方案', done: '行程整合完成' },
    validation: { label: '行程校验', running: '正在校验预算、天气和每日路线', done: '行程校验完成', warning: '发现可优化项，正在调整' },
    replan: { label: '自动调整', running: '正在根据校验结果自动调整行程', done: '行程调整完成' },
}

const STAGE_LABELS = {
    data: '获取实时数据',
    verification: '核验推荐景点',
    replan: '自动调整行程',
}

const upsertAgentStep = (key, label, status) => {
    const existing = agentSteps.value.find((step) => step.key === key)
    if (existing) {
        existing.label = label || existing.label
        existing.status = status
    } else {
        agentSteps.value.push({ key, label: label || key, status })
    }
}

const startAgentStep = (key, label) => {
    agentSteps.value.forEach((step) => {
        if (step.status === 'running') step.status = 'completed'
    })
    upsertAgentStep(key, label, 'running')
}

const completeAgentStep = (key, label, status = 'completed') => {
    upsertAgentStep(key, label, status)
}
const weatherForecasts = computed(() => {
  // 天气接口返回今天起 7 天，行程从明天开始，因此从第 2 条（明天）起取 days 天。
  const forecasts = realtimeContext.value.weather?.forecasts || []
  const days = Math.max(1, Number(formData.days) || 1)
  return forecasts.slice(1, 1 + days)
})

const formatShortDate = (value) => {
  const [y, m, d] = String(value || '').split('-')
  return y && m && d ? `${Number(m)}月${Number(d)}日` : value || ''
}

const tripDateRange = computed(() => {
  const plan = tripData.value?.data
  if (plan?.start_date && plan?.end_date) {
    return `${formatShortDate(plan.start_date)} ~ ${formatShortDate(plan.end_date)}`
  }
  return ''
})

const dayTitle = (day) => {
  const dateText = day?.date ? `（${formatShortDate(day.date)}）` : ''
  return `第${day?.day}天${dateText}`
}

const formatFetchedAt = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '刚刚'

const transportAdviceText = (advice, key) => {
    const item = advice?.[key]
    const text = typeof item === 'string' ? item : item?.text || item?.description || ''
    const rawCost = advice?.[`${key}_cost`] ?? item?.cost
    const cost = Number(String(rawCost ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0])
    return Number.isFinite(cost) && cost > 0 ? `${text}（¥${cost}，已计入交通预算）` : text
}

const transportAlternatives = computed(() => {
    const alternatives = tripData.value?.data?.transport_advice?.to_city_alternatives
    return Array.isArray(alternatives) ? alternatives.filter((item) => item && typeof item === 'object') : []
})

const transportAlternativeText = (alternative) => {
    const text = [alternative.name, alternative.description].filter(Boolean).join('：')
    const cost = Number(String(alternative.cost ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0])
    return Number.isFinite(cost) && cost > 0 ? `${text}（约¥${cost}，未计入预算）` : text
}

const createEmptyPlan = () => ({
    city: formData.city,
    budget: Number(formData.budget) || 0,
    days: Number(formData.days) || 0,
    daily_schedule: [],
    transport_advice: null,
    budget_breakdown: null,
    notes: [],
})

const ensurePlan = () => {
    if (!tripData.value) tripData.value = { status: 200, data: createEmptyPlan() }
    return tripData.value.data
}

const planHasContent = computed(() => {
    const plan = tripData.value?.data
    return Boolean(plan && (
        (Array.isArray(plan.daily_schedule) && plan.daily_schedule.length)
        || plan.budget_breakdown
        || (Array.isArray(plan.notes) && plan.notes.length)
    ))
})

// 兼容接口返回的 data/plan 包装层，以及部分模型把 daily_schedule 返回为对象的情况。
const normalizePlanPayload = (payload) => {
    let value = payload
    if (value && typeof value === 'object' && value.data && typeof value.data === 'object' && !Array.isArray(value.data)) {
        value = value.data
    }
    if (value && typeof value === 'object' && value.plan && typeof value.plan === 'object' && !Array.isArray(value.plan)) {
        value = value.plan
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    let schedule = value.daily_schedule
    if (!Array.isArray(schedule) && schedule && typeof schedule === 'object') {
        schedule = Object.entries(schedule).map(([day, data]) => ({
            ...(data && typeof data === 'object' ? data : {}),
            day: Number(data?.day || day) || day,
        }))
    }
    if (!Array.isArray(schedule) && Array.isArray(value.schedule)) schedule = value.schedule
    if (!Array.isArray(schedule)) return null
    return { ...value, daily_schedule: schedule }
}

//行程规划逻辑
const fetchTripData = async ()=>{
    isLoading.value = true
    errorMsg.value = ''
    tripData.value = { status: 200, data: createEmptyPlan() }
    showBudgetChart.value = false
    realtimeContext.value = { weather: null, sources: [], fetchedAt: '' }
    agentSteps.value = []
    currentActivity.value = ''
    progressMessage.value = '正在连接规划服务...'

    await fetchStream(
        'recommend',
        {
            origin: formData.origin,
            city: formData.city,
            budget: formData.budget,
            days: formData.days,
        },
        undefined,
        async (payload) => {
            // 服务端错误后的 SSE end 标记不是行程数据，不能进入完整结果解析。
            if (payload?.done === true || payload?.type === 'error' || payload?.error) return
            if (!payload || payload.success === false) {
                if (planHasContent.value) return
                errorMsg.value = payload?.message || '行程生成失败，请稍后重试'
                isLoading.value = false
                return
            }
            const normalizedPayload = normalizePlanPayload(payload)
            if (!normalizedPayload) {
                if (planHasContent.value) {
                    errorMsg.value = ''
                    isLoading.value = false
                    return
                }
                errorMsg.value = '行程数据暂不可用，请点击重试'
                isLoading.value = false
                return
            }

            tripData.value = { status: 200, data: normalizedPayload }
            realtimeContext.value = normalizedPayload.realtime_context || realtimeContext.value
            isLoading.value = false
            currentActivity.value = ''
            await nextTick()
            setTimeout(() => { showBudgetChart.value = true }, 0)
            travelStore.setPlan(normalizedPayload)
            setTimeout(() => {
                savePlan({
                    title: `${formData.city} · ${formData.days}天行程`,
                    city: formData.city,
                    budget: formData.budget,
                    days: formData.days,
                    plan: normalizedPayload,
                })
            }, 0)
        },
        (message) => {
            // 流式渲染过程中偶发的回调异常不应打断已经生成出来的内容
            if (planHasContent.value) {
                errorMsg.value = ''
                currentActivity.value = ''
                isLoading.value = false
                return
            }
            errorMsg.value = message || '行程生成失败，请稍后重试'
            currentActivity.value = ''
            tripData.value = null
            isLoading.value = false
        },
        (event) => {
            if (event.type === 'stage') {
                startAgentStep(event.stage, STAGE_LABELS[event.stage] || event.label || event.stage)
                progressMessage.value = event.label || event.stage || progressMessage.value
            } else if (event.type === 'error') {
                if (!planHasContent.value) {
                    errorMsg.value = event.message || '行程生成失败，请稍后重试'
                }
            } else if (event.type === 'agent_step') {
                const meta = AGENT_STEP_META[event.step] || { label: event.step }
                if (event.status === 'running') {
                    startAgentStep(event.step, meta.label)
                    progressMessage.value = meta.running || progressMessage.value
                } else if (event.status === 'completed' || event.status === 'warning') {
                    completeAgentStep(event.step, meta.label, event.status)
                    progressMessage.value = (event.status === 'completed' ? meta.done : meta.warning) || progressMessage.value
                } else if (event.status === 'failed') {
                    completeAgentStep(event.step, meta.label, 'failed')
                    progressMessage.value = `${meta.label}执行失败，正在尝试兜底方案`
                }
            } else if (event.type === 'agent_call') {
                // 独立 HTTP 进程调用中，无需额外渲染
            } else if (event.type === 'agent_context') {
                const agents = event.agents || []
                agents.forEach((agent) => {
                    const existing = agentSteps.value.find((step) => step.key === agent.key)
                    const label = agent.label || AGENT_STEP_META[agent.key]?.label || agent.key
                    const status = agent.status === 'failed' ? 'failed' : 'completed'
                    if (existing) {
                        existing.label = label
                        existing.status = status
                        existing.duration_ms = agent.duration_ms
                    } else {
                        agentSteps.value.push({ key: agent.key, label, status, duration_ms: agent.duration_ms })
                    }
                })
                currentActivity.value = ''
            } else if (event.type === 'data_context') {
                realtimeContext.value = {
                    weather: event.weather || null,
                    sources: event.sources || [],
                    fetchedAt: event.fetchedAt || '',
                }
                progressMessage.value = event.available
                    ? '实时天气、景点和路线数据已获取，正在生成行程'
                    : '实时数据暂不可用，正在使用通用规划'
            } else if (event.type === 'poi_verification') {
                progressMessage.value = '景点核验完成'
            } else if (event.type === 'agent_tool') {
                const labels = {
                    validate_plan: '正在综合校验行程',
                    validate_budget: '正在核算预算',
                    get_weather: '正在查询天气',
                    search_spots: '正在查询景点',
                    get_route: '正在计算路线',
                    verify_spot: '正在核验景点',
                }
                if (event.status === 'completed') {
                    currentActivity.value = ''
                    progressMessage.value = `${labels[event.tool] || 'Agent 工具'}完成`
                } else {
                    currentActivity.value = labels[event.tool] || 'Agent 正在调用实时工具'
                    progressMessage.value = currentActivity.value
                }
            } else if (event.type === 'plan_validation') {
                console.info('[travel/recommend] validation.issues', event.issues || [])
                progressMessage.value = event.valid ? '行程校验通过' : '发现可优化项，正在调整行程'
            } else if (event.type === 'timing') {
                console.info('[travel/recommend] performance', event.data || {})
            } else if (event.type === 'meta') {
                const plan = ensurePlan()
                plan.city = event.city || plan.city
                plan.budget = event.budget ?? plan.budget
                plan.days = event.days ?? plan.days
                progressMessage.value = '行程基本信息已生成，正在规划每日路线'
            } else if (event.type === 'day') {
                const plan = ensurePlan()
                const dayData = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : event
                if (!dayData || typeof dayData !== 'object' || !dayData.day) return
                const normalized = { ...dayData }
                const periodMap = { 上午: 'morning', 早上: 'morning', 下午: 'afternoon', 中午: 'afternoon', 午餐: 'afternoon', 晚上: 'evening' }
                Object.keys(periodMap).forEach((key) => {
                    if (normalized[key] !== undefined) {
                        normalized[periodMap[key]] = normalized[key]
                        delete normalized[key]
                    }
                })
                const index = plan.daily_schedule.findIndex((day) => day.day === normalized.day)
                if (index >= 0) plan.daily_schedule[index] = normalized
                else plan.daily_schedule.push(normalized)
                plan.daily_schedule.sort((a, b) => a.day - b.day)
                if (isLoading.value && !activeDays.value.includes(normalized.day)) {
                    activeDays.value.push(normalized.day)
                }
                progressMessage.value = `第 ${normalized.day} 天行程已生成`
            } else if (event.type === 'slot' && event.data && event.day && event.period) {
                const plan = ensurePlan()
                let day = plan.daily_schedule.find((item) => item.day === event.day)
                if (!day) {
                    day = { day: event.day }
                    plan.daily_schedule.push(day)
                    plan.daily_schedule.sort((a, b) => a.day - b.day)
                }
                day[event.period] = event.data
                if (isLoading.value && !activeDays.value.includes(event.day)) {
                    activeDays.value.push(event.day)
                }
                progressMessage.value = `第 ${event.day} 天${event.period === 'morning' ? '上午' : event.period === 'afternoon' ? '下午' : '晚上'}已生成`
            } else if (event.type === 'field' && event.day && event.period && event.field) {
                const plan = ensurePlan()
                let day = plan.daily_schedule.find((item) => item.day === event.day)
                if (!day) {
                    day = { day: event.day }
                    plan.daily_schedule.push(day)
                    plan.daily_schedule.sort((a, b) => a.day - b.day)
                }
                if (!day[event.period]) day[event.period] = {}
                day[event.period][event.field] = event.value
                if (isLoading.value && !activeDays.value.includes(event.day)) {
                    activeDays.value.push(event.day)
                }
                progressMessage.value = `第 ${event.day} 天${event.period === 'morning' ? '上午' : event.period === 'afternoon' ? '下午' : '晚上'}内容已更新`
            } else if (event.type === 'transport_advice') {
                ensurePlan().transport_advice = event.data
            } else if (event.type === 'budget_breakdown') {
                ensurePlan().budget_breakdown = event.data
            } else if (event.type === 'notes') {
                ensurePlan().notes = Array.isArray(event.data) ? event.data : []
            }
        },
    )
}
//跳转AI聊天
const handleChatClick = () =>{
    router.push({
        path:'/chat',
        query:{
            city:formData.city,
            budget:formData.budget,
            days:formData.days
        }
    })
}
onMounted(()=>{
    formData.origin = route.query.origin || ''
    formData.city = route.query.city
    formData.budget = route.query.budget
    formData.days = route.query.days
    
            if (route.query.planId) {
        const savedPlan = getPlanById(route.query.planId)
        if (savedPlan && savedPlan.plan) {
            tripData.value = {
                status: 200,
                data: savedPlan.plan
            }
            realtimeContext.value = savedPlan.plan.realtime_context || realtimeContext.value
            setTimeout(() => { showBudgetChart.value = true }, 0)
            travelStore.setPlan(savedPlan.plan)
            isLoading.value = false
            currentActivity.value = ''
            agentSteps.value = savedPlan.plan.agent_trace?.map((step) => ({
                key: step.key,
                label: step.label,
                status: step.status,
                duration_ms: step.duration_ms,
            })) || []
            return
        } else {
            showToast('未找到保存的规划')
        }
    }
    
    if(formData.city && formData.budget && formData.days){
        fetchTripData()
    }
})
const onClickLeft = () => {
    router.back()
}
</script>
<style scoped>
.page-content {
    min-height: 100vh;
    padding-top: calc(46px + env(safe-area-inset-top));
    padding-bottom: 50px;
    box-sizing: border-box;
}

.loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 20vh;
}

.error-container {
    margin: 12px 10px;
}

.error-banner {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 12px 10px 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: #fdf0ec;
    border: 1px solid #f3cfc3;
    color: var(--orange-600);
    font-size: 13px;
    line-height: 1.5;
}

.error-banner :deep(.van-icon) {
    flex: 0 0 auto;
    margin-top: 2px;
}

.agent-progress-card {
    border-color: var(--orange-200);
    background: linear-gradient(180deg, var(--paper) 0%, #fdf8f0 100%);
}

.agent-progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1px dashed var(--line);
}

.agent-progress-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--olive-950);
}

.agent-progress-title :deep(.van-icon) {
    font-size: 16px;
    color: var(--orange-600);
}

.agent-step-list {
    margin-top: 12px;
}

.agent-step-item {
    position: relative;
    display: flex;
    align-items: center;
    padding: 7px 0;
    font-size: 14px;
}

.agent-step-item::before {
    content: '';
    position: absolute;
    top: -7px;
    bottom: -7px;
    left: 7px;
    width: 1px;
    background: var(--sand-300);
}

.agent-step-item:first-child::before {
    top: 50%;
}

.agent-step-item:last-child::before {
    bottom: 50%;
}

.agent-step-dot {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    margin-right: 10px;
}

.step-icon {
    font-size: 15px;
}

.step-icon.done { color: var(--olive-600); }
.step-icon.failed { color: var(--orange-600); }
.step-icon.running { color: var(--orange-600); }

.step-icon.pending {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sand-300);
}

.agent-step-label {
    flex: 1;
    min-width: 0;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-step-status {
    flex: 0 0 auto;
    margin-left: 8px;
    font-size: 12px;
    padding: 1px 6px;
    border-radius: 4px;
}

.agent-step-status.running { color: var(--orange-600); background: var(--orange-100); }
.agent-step-status.done { color: var(--olive-700); background: #e8eddc; }
.agent-step-status.failed { color: #b3543f; background: #f8e0d6; }

.agent-step-item.failed .agent-step-label { color: var(--orange-600); }

.agent-current-activity {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--sand-100);
    font-size: 13px;
    color: var(--olive-800);
    overflow: hidden;
}

.agent-current-activity :deep(.van-icon) {
    flex: 0 0 auto;
    font-size: 15px;
    color: var(--orange-600);
    animation: activity-blink 1.2s ease-in-out infinite;
}

.agent-current-activity span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@keyframes activity-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
}

.slot-streaming {
    display: flex;
    align-items: center;
    padding: 14px 16px;
}

.slot-streaming-text {
    position: relative;
    padding-left: 16px;
    font-size: 13px;
    color: var(--muted);
}

.slot-streaming-text::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 8px;
    height: 8px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--orange-500);
    animation: streaming-pulse 1.2s ease-in-out infinite;
}

@keyframes streaming-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
}

.card-container {
    margin: 12px 10px;
    background-color: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 18px;
    box-sizing: border-box;
    box-shadow: var(--card-shadow);
}

.trip-summary {
    border-color: var(--sand-300);
    box-shadow: var(--card-shadow);
}

.trip-dates {
    margin-top: 8px;
    font-size: 13px;
    color: var(--olive-700);
}

.trip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.trip-header h2 {
    font-size: 20px;
    font-weight: 700;
    color: var(--olive-950);
    margin: 0;
    line-height: 1.35;
}

.trip-budget {
    font-size: 15px;
    color: var(--orange-600);
    font-weight: 600;
    white-space: nowrap;
}
.stream-progress {
    margin-top: 10px;
    color: var(--olive-700);
    font-size: 13px;
}
.realtime-card { border-color: #cdd7b9; background: #f9f9ef; }
.realtime-title { color: var(--olive-700); font-weight: 600; margin-bottom: 10px; }
.weather-list { display: grid; gap: 8px; }
.weather-item { display: flex; justify-content: space-between; color: var(--olive-800); font-size: 13px; }
.data-sources { margin-top: 12px; color: var(--muted); font-size: 11px; line-height: 1.5; }
.section-title { font-size: 16px; font-weight: 600; color: var(--olive-950); margin-bottom: 4px; }
.budget-chart-placeholder { height: 280px; }
.itinerary-card {
    padding: 0;
    overflow: hidden;
    border-color: var(--line);
}

.itinerary-card :deep(.van-collapse-item__title) {
    padding: 16px 18px;
    font-size: 17px;
    font-weight: 600;
    color: var(--olive-950);
    background: var(--paper);
}

.itinerary-card :deep(.van-collapse-item__content) {
    padding: 0;
    background: var(--sand-100);
}

.day-schedule {
    padding: 4px 16px 10px;
}

.schedule-slot {
    position: relative;
}

.schedule-slot + .schedule-slot {
    border-top: 1px dashed var(--line);
}
.transport-card {
    background-color: var(--paper);
    border-radius: 8px;
    margin: 10px;
    overflow: hidden;
}

.transport-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: var(--orange-100);
    color: var(--orange-600);
    border-bottom: 1px solid #edc8b1;
}

.transport-header :deep(.van-icon) {
    margin-right: 8px;
    font-size: 16px;
}

.transport-header span {
    font-size: 16px;
    font-weight: 600;
}

.transport-content {
    padding: 16px;
}

.transport-item {
    display: flex;
    padding: 8px 0;
    border-bottom: 1px dashed var(--line);
}

.transport-item:last-child {
    border-bottom: none;
}

.transport-label {
    font-size: 14px;
    color: var(--muted);
    flex-shrink: 0;
}

.transport-value {
    font-size: 14px;
    color: var(--ink);
    flex: 1;
}

.chat-button-container {
    display: flex;
    justify-content: center;
    padding: 16px 0;
    margin-top: 16px;
}

.chat-button-container :deep(.van-button) {
    width: 100%;
    max-width: 280px;
}
</style>
