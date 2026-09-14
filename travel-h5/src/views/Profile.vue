<template>
  <div class="profile-container">
    <van-nav-bar title="我的" left-arrow fixed safe-area-inset-top @click-left="onClickLeft" />

    <div class="user-header" @click="showNicknameDialog = true">
      <div class="avatar-wrapper">
        <img
          :src="avatarUrl"
          alt="头像"
          class="avatar"
        />
      </div>
      <div class="user-info">
        <h2 class="username">{{ nickname }}</h2>
        <p class="welcome-text">欢迎使用智能旅游助手</p>
      </div>
      <van-icon name="edit" class="edit-icon" />
    </div>

    <!-- <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">{{ planCount }}</div>
        <div class="stat-label">我的规划</div>
      </div>
    </div> -->

    <div class="section">
      <div class="section-title">快捷入口</div>
      <van-cell-group inset class="menu-group">
        <van-cell title="我的规划" icon="orders-o" is-link @click="handlePlans" />
        <van-cell title="浏览记录" icon="clock-o" is-link @click="handleHistory" />
        <van-cell title="我的收藏" icon="star-o" is-link @click="handleFavorite">
          <template #value>{{ favoriteCount }} 个景点</template>
        </van-cell>
        <van-cell title="AI旅行助手" icon="chat-o" is-link @click="handleChat" />
      </van-cell-group>
    </div>

    <div class="section">
      <div class="section-title">我的服务</div>
      <van-cell-group inset class="menu-group">
        <van-cell title="设置" icon="setting-o" is-link @click="handleSettings" />
        <van-cell title="关于我们" is-link @click="handleAbout" />
        <van-cell title="版本信息" :value="version" />
      </van-cell-group>
    </div>

    <div class="section" v-if="recentPlans.length > 0">
      <div class="section-title">最近行程</div>
      <van-cell-group inset class="menu-group">
        <van-cell
          v-for="plan in recentPlans"
          :key="plan.id"
          :title="plan.title"
          :label="formatDate(plan.createdAt)"
          is-link
          @click="viewPlan(plan)"
        />
      </van-cell-group>
    </div>

    <van-dialog
      v-model:show="showNicknameDialog"
      title="修改昵称"
      show-cancel-button
      @confirm="saveNickname"
    >
      <van-field
        v-model="editingNickname"
        placeholder="请输入昵称"
        maxlength="20"
        clearable
        autofocus
      />
    </van-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { showToast } from 'vant'
import { useRouter } from 'vue-router'
import { getPlans, getFavorites } from '../utils/travelStorage'
import avatarImg from '../assets/用户 .png'

const NICKNAME_KEY = 'travel-agent-nickname'

const router = useRouter()
const version = ref('v1.0.0')
const avatarUrl = ref(avatarImg)

const showNicknameDialog = ref(false)
const editingNickname = ref('')

const nickname = ref(localStorage.getItem(NICKNAME_KEY) || '游客')

const plans = ref([])
const favorites = ref([])

const planCount = computed(() => plans.value.length)
const favoriteCount = computed(() => favorites.value.length)

const recentPlans = computed(() => plans.value.slice(0, 3))

const loadData = () => {
  plans.value = getPlans()
  favorites.value = getFavorites()
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

const saveNickname = () => {
  const name = editingNickname.value.trim()
  if (!name) {
    showToast('昵称不能为空')
    return
  }
  nickname.value = name
  localStorage.setItem(NICKNAME_KEY, name)
  showToast('昵称已更新')
}

const onClickLeft = () => {
  router.back()
}

const handleHistory = () => {
  router.push('/history')
}

const handleFavorite = () => {
  router.push('/favorite')
}

const handlePlans = () => {
  router.push('/plans')
}

const handleChat = () => {
  router.push('/chat')
}

const handleSettings = () => {
  router.push('/settings')
}

const handleAbout = () => {
  router.push('/about')
}

const viewPlan = (plan) => {
  router.push({
    path: '/detail',
    query: {
      city: plan.city,
      budget: plan.budget,
      days: plan.days,
      planId: plan.id,
    },
  })
}

onMounted(() => {
  loadData()
  editingNickname.value = nickname.value
})

// 页面激活时（keep-alive 或重新显示）刷新数据
onActivated(() => {
  loadData()
})

// 窗口可见性变化时刷新（用户在其它页面生成行程/对话后切换回来）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadData()
  }
})
</script>

<style scoped>
.profile-container {
  min-height: 100vh;
  padding-top: calc(46px + env(safe-area-inset-top));
  padding-bottom: 20px;
  background: transparent;
}

.user-header {
  display: flex;
  align-items: center;
  padding: 40px 20px 24px;
  background: var(--olive-800);
  box-shadow: 0 10px 22px rgba(74, 62, 43, 0.14);
  cursor: pointer;
  transition: opacity 0.15s;
}

.user-header:active {
  opacity: 0.85;
}

.avatar-wrapper {
  margin-right: 16px;
}

.avatar {
  width: 80px;
  height: 80px;
  border: 3px solid rgba(255, 250, 241, 0.52);
  border-radius: 50%;
  object-fit: cover;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.username {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.welcome-text {
  margin: 0;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

.edit-icon {
  flex-shrink: 0;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.6);
}

.stats-grid {
  display: grid;
  grid-template-columns: minmax(0, 190px);
  justify-content: center;
  max-width: 380px;
  gap: 10px;
  margin: -18px 12px 0;
}

.stat-card {
  padding: 14px 0;
  text-align: center;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--card-shadow);
}

.stat-number {
  font-size: 18px;
  font-weight: 700;
  color: var(--orange-600);
}

.stat-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.section {
  margin-top: 16px;
}

.section-title {
  padding: 12px 16px 8px;
  font-size: 12px;
  color: var(--muted);
}

.menu-group {
  margin: 0 12px;
  border-radius: 10px;
}

.section-title { padding-left: 18px; font-family: var(--heading); color: var(--olive-800); }
.menu-group :deep(.van-cell) { background: var(--paper); }
</style>
