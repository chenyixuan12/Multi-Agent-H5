<template>
  <div class="page">
    <van-nav-bar title="我的收藏" left-arrow fixed safe-area-inset-top @click-left="goBack" />

    <div class="content">
      <van-empty v-if="favorites.length === 0" description="还没有收藏景点">
        <van-button type="primary" @click="goPlans">去看看行程</van-button>
      </van-empty>

      <van-cell-group v-else inset>
        <van-cell v-for="item in favorites" :key="item.id" class="favorite-cell">
          <template #title>
            <div class="favorite-name">{{ item.name }}</div>
            <div class="favorite-label">{{ favoriteLabel(item) }}</div>
          </template>
          <template #value>
            <div class="favorite-actions">
              <van-button
                size="small"
                type="primary"
                plain
                class="action-button"
                @click.stop="addToPlan(item)"
              >
                加入规划
              </van-button>
              <van-button
                size="small"
                type="danger"
                plain
                class="action-button"
                @click.stop="removeFavorite(item)"
              >
                取消收藏
              </van-button>
            </div>
          </template>
        </van-cell>
      </van-cell-group>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { deleteFavorite, getFavorites } from '../utils/travelStorage'

const router = useRouter()
const favorites = ref([])

const goBack = () => router.back()
const goPlans = () => router.push('/plans')

const addToPlan = (item) => {
  const prompt = `我计划去${item.city || '这个城市'}旅行，请把${item.name}加入我的行程规划，并推荐适合的游玩时长、交通和附近餐饮。`
  router.push({
    path: '/chat',
    query: {
      city: item.city || '',
      prompt,
    },
  })
}

const loadFavorites = () => {
  favorites.value = getFavorites()
}

const favoriteLabel = (item) => {
  const details = [
    item.city,
    item.duration && `游玩${item.duration}`,
    item.ticket !== '' && item.ticket !== null && item.ticket !== undefined && `门票${item.ticket}`,
  ].filter(Boolean)
  return details.join(' · ') || '已收藏景点'
}

const removeFavorite = (item) => {
  favorites.value = deleteFavorite(item.id)
  showToast('已取消收藏')
}

onMounted(loadFavorites)
onActivated(loadFavorites)
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding-top: calc(46px + env(safe-area-inset-top));
  background: transparent;
}
.content {
  padding: 12px;
}
.favorite-cell :deep(.van-cell__value) {
  flex: 0 0 auto;
  max-width: 52%;
}
.favorite-name {
  color: var(--ink);
  font-size: 16px;
  line-height: 1.5;
}
.favorite-label {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
.favorite-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.action-button {
  min-width: 64px;
  height: 30px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 12px;
}
</style>
