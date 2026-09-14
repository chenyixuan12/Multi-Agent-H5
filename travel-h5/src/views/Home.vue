<template>
  <div class="home-container">
    <van-nav-bar title="智能旅游助手" right-text="刷新" @click-right="onClickRight" />

    <van-notice-bar left-icon="volume-o" text="基于AI的智能景点介绍与行程规划系统" />

    <div class="card-container hero-card">
      <div class="hero-title">规划你的专属旅程</div>
      <div class="hero-subtitle">输入城市、预算与天数，快速生成结构化行程方案</div>
    </div>

    <div class="card-container">
      <div class="title">规划你的行程</div>
      <div class="card">
        <van-field
          v-model="formCity.origin"
          label="出发地"
          placeholder="请选择出发地"
          is-link
          readonly
          @click="openCityPicker('origin')"
        />
      </div>
      <div class="card">
        <van-field
          v-model="formCity.city"
          label="目的地"
          placeholder="请输入目的地"
          is-link
          readonly
          @click="openCityPicker('city')"
        />
      </div>
      <div class="card">
        <van-field
          v-model="formCity.budget"
          type="number"
          label="预算(元)"
          placeholder="请输入预算金额"
        />
      </div>
      <div class="card">
        <van-field
          v-model="formCity.days"
          type="number"
          label="天数"
          placeholder="请输入旅行天数"
        />
      </div>
      <van-button
        type="primary"
        block
        class="plan-btn"
        :loading="isloading"
        @click="planTrip"
      >
        开始规划
      </van-button>
    </div>

    <div class="card-container">
      <div class="title">快捷入口</div>
      <van-grid :column-num="2" :gutter="12">
        <van-grid-item icon="chat-o" text="AI对话" @click="goChat" />
        <van-grid-item icon="user-o" text="我的" @click="goProfile" />
      </van-grid>
    </div>

    <div class="card-container">
      <div class="title">热门目的地</div>
      <van-grid :column-num="4" :gutter="8">
        <van-grid-item v-for="item in hotCities" :key="item" @click="selectHotCity(item)">
          <div class="city-tag" :class="{ active: formCity.city === item }">
            {{ item }}
          </div>
        </van-grid-item>
      </van-grid>
    </div>

    <van-popup v-model:show="showCityPicker" round position="bottom">
      <van-cascader
        v-model="cascaderValue"
        :title="pickerTarget === 'origin' ? '请选择出发地' : '请选择目的地'"
        :options="allCities"
        @close="showCityPicker = false"
        @finish="onFinish"
      />
    </van-popup>
  </div>
</template>


<script setup>
import { reactive, ref } from 'vue'
import { showToast } from 'vant'
import { useRouter } from 'vue-router'
import { provinceCityOptions } from '../utils/cityData'

const router = useRouter()
const isloading = ref(false)
const showCityPicker = ref(false)
const cascaderValue = ref('')
// 当前选择器作用于哪个字段：origin（出发地）/ city（目的地）
const pickerTarget = ref('city')
const formCity = reactive({
  origin: '',
  budget: '',
  city: null,
  days: null,
})

const allCities = provinceCityOptions

const hotCities = ref(['浙江', '江苏', '北京', '上海', '天津', '重庆', '广东', '成都'])

const planTrip = () => {
  isloading.value = true
  if (!formCity.origin) {
    showToast('请选择出发地')
    isloading.value = false
    return
  }
  if (!formCity.city) {
    showToast('请选择目的地')
    isloading.value = false
    return
  }
  if (!formCity.budget || formCity.budget <= 100) {
    showToast('预算金额不能小于100元')
    isloading.value = false
    return
  }
  if (!formCity.days || formCity.days < 1 || formCity.days > 30) {
    showToast('旅行天数不能小于1天或大于30天')
    isloading.value = false
    return
  }

  router.push({
    path: '/detail',
    query: {
      origin: formCity.origin,
      city: formCity.city,
      budget: formCity.budget,
      days: formCity.days,
    },
  })
  isloading.value = false
}

const goChat = () => {
  router.push('/chat')
}

const goProfile = () => {
  router.push('/profile')
}

const onClickRight = () => {
  formCity.origin = ''
  formCity.city = null
  formCity.budget = ''
  formCity.days = null
  cascaderValue.value = ''
  showToast('已重置表单')
}

const openCityPicker = (target) => {
  pickerTarget.value = target
  // 每次打开都从省级列表重新开始选择，避免残留上一次的选中路径
  cascaderValue.value = ''
  showCityPicker.value = true
}

const selectHotCity = (item) => {
  formCity.city = item
  showToast(`已选择 ${item}`)
}

const onFinish = ({ selectedOptions }) => {
  showCityPicker.value = false
  const selected = selectedOptions[selectedOptions.length - 1]?.text || ''
  if (pickerTarget.value === 'origin') {
    formCity.origin = selected
  } else {
    formCity.city = selected
  }
}
</script>
<style scoped>
.home-container {
  min-height: 100vh;
  padding: 10px 10px 24px;
  background-color: transparent;
}

.card-container {
  position: relative;
  margin-top: 14px;
  padding: 17px;
  background-color: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--card-shadow);
}

.hero-card {
  overflow: hidden;
  padding: 22px 20px 24px;
  color: #fffaf1;
  background: var(--olive-800);
  border: 0;
  box-shadow: 0 4px 0 rgba(48, 56, 42, 0.12), 0 16px 26px rgba(74, 62, 43, 0.16);
}

.hero-card::after {
  content: "旅 / 行 / 手 / 账";
  position: absolute;
  right: 18px;
  bottom: 14px;
  color: rgba(255, 250, 241, 0.26);
  font-size: 11px;
  letter-spacing: .28em;
}

.hero-title {
  position: relative;
  z-index: 1;
  font-family: var(--heading);
  font-size: 22px;
  letter-spacing: .05em;
  font-weight: 700;
}

.hero-subtitle {
  position: relative;
  z-index: 1;
  margin-top: 6px;
  max-width: 260px;
  font-size: 13px;
  color: rgba(255, 250, 241, 0.76);
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 13px;
  font-family: var(--heading);
  font-size: 18px;
  font-weight: bold;
  color: var(--olive-950);
}

.title::before {
  content: "";
  width: 4px;
  height: 18px;
  border-radius: 3px;
  background: var(--orange-500);
}

.card {
  display: flex;
  align-items: center;
  min-height: 44px;
  border-bottom: 1px dashed var(--line);
}

.card:last-of-type {
  border-bottom: none;
}

.plan-btn {
  height: 46px;
  margin-top: 18px;
  border-radius: 8px;
  font-weight: 700;
  letter-spacing: .08em;
}

.city-tag {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid var(--sand-300);
  border-radius: 6px;
  font-size: 12px;
  color: var(--olive-800);
  background: var(--sand-100);
  text-align: center;
}

.city-tag.active {
  color: #fffaf1;
  border-color: var(--orange-600);
  background-color: var(--orange-600);
}

.card :deep(.van-field) { padding-left: 0; padding-right: 0; background: transparent; }
.card :deep(.van-field__control::placeholder) { color: #b0aa9d; }
.card-container :deep(.van-grid-item__content) { padding: 14px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--sand-100); }
.card-container :deep(.van-grid-item__content:active) { background: var(--sand-200); }
.card-container :deep(.van-grid-item__icon) { color: var(--olive-700); font-size: 24px; }
.card-container :deep(.van-grid-item__text) { color: var(--olive-800); font-size: 13px; }
</style>
