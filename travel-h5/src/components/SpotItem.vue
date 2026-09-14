<template>
  <div class="spot-item">
    <div class="time-column">
      <div class="time-tag" :class="timeClass">{{ timeLabel }}</div>
      <div class="time-line" aria-hidden="true"></div>
    </div>

    <div class="spot-content">
      <h3 class="spot-title">
        <span class="spot-name">{{ spot.spot }}</span>
        <span v-if="spot.poi?.verified" class="poi-badge verified">已核验</span>
        <span v-else-if="spot.poi" class="poi-badge pending">待核验</span>
        <button
          type="button"
          class="favorite-button"
          :class="{ active: favorite }"
          :aria-label="favorite ? '取消收藏' : '收藏景点'"
          @click.stop="toggleFavorite"
        >
          <van-icon :name="favorite ? 'star' : 'star-o'" />
        </button>
      </h3>

      <p v-if="spot.description" class="spot-description">{{ spot.description }}</p>

      <div class="spot-details">
        <div class="detail-item">
          <span class="detail-label">游玩时间</span>
          <span class="detail-value">{{ spot.duration || '暂无' }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">门票费用</span>
          <span class="detail-value">{{ ticketText }}</span>
        </div>
        <div class="detail-item detail-block">
          <van-icon name="guide-o" />
          <span class="detail-label">交通方式</span>
          <span class="detail-value">{{ transportText }}</span>
        </div>
        <div class="detail-item detail-block">
          <van-icon name="shopping-cart-o" />
          <span class="detail-label">餐饮建议</span>
          <span class="detail-value">{{ mealText }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import { deleteFavorite, favoriteId, isFavorite, saveFavorite } from '../utils/travelStorage'

const props = defineProps({
  spot: {
    type: Object,
    required: true,
  },
  time: {
    type: String,
    default: 'morning',
  },
  city: {
    type: String,
    default: '',
  },
})

const favorite = ref(false)
const currentFavoriteId = computed(() => favoriteId(props.city, props.spot?.spot))

const toggleFavorite = () => {
  const id = currentFavoriteId.value
  if (!props.spot?.spot) return
  if (favorite.value) {
    deleteFavorite(id)
    favorite.value = false
    showToast('已取消收藏')
    return
  }
  saveFavorite({
    id,
    city: props.city,
    name: props.spot.spot,
    description: props.spot.description || '',
    duration: props.spot.duration || '',
    ticket: props.spot.ticket ?? '',
    transport: props.spot.transport || '',
    meal: props.spot.meal || '',
  })
  favorite.value = true
  showToast('已收藏景点')
}

onMounted(() => {
  favorite.value = isFavorite(currentFavoriteId.value)
})

watch(currentFavoriteId, (id) => {
  favorite.value = isFavorite(id)
})

const timeLabel = computed(() => {
  const labels = {
    morning: '上午',
    afternoon: '下午',
    evening: '晚上',
  }
  return labels[props.time] || '上午'
})

const timeClass = computed(() => `time-${props.time}`)

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const match = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

const transportText = computed(() => {
  const transport = props.spot?.transport
  if (!transport) return '暂无'
  if (typeof transport === 'string') return transport
  const summary = [transport.from && `从${transport.from}`, transport.to && `到${transport.to}`].filter(Boolean).join('，')
  const route = transport.route || transport.description
  const cost = toNumber(transport.cost)
  const details = [transport.method || transport.mode, route, transport.duration && `耗时${transport.duration}`, cost > 0 && `约${cost}元`]
    .filter(Boolean)
    .join('，')
  return [summary, details].filter(Boolean).join('；') || '暂无'
})

const ticketText = computed(() => {
  if (props.spot?.ticket === null || props.spot?.ticket === undefined || props.spot?.ticket === '') return '暂无'
  const value = toNumber(props.spot.ticket)
  return value > 0 ? `${value}元` : String(props.spot.ticket)
})

const mealText = computed(() => {
  const meal = props.spot?.meal
  if (!meal) return '暂无'
  if (typeof meal === 'string') return meal
  const cost = toNumber(meal.cost)
  return `${meal.recommendation || '暂无'}，约${cost}元`
})
</script>

<style scoped>
.spot-item {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  column-gap: 12px;
  padding: 18px 2px;
  background-color: transparent;
}

.time-column {
  position: relative;
  display: flex;
  justify-content: flex-start;
}

.time-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 28px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  box-sizing: border-box;
}

.time-morning {
  color: var(--orange-600);
  background-color: var(--orange-100);
}

.time-afternoon {
  color: var(--olive-700);
  background-color: #e8eddc;
}

.time-evening {
  color: var(--olive-800);
  background-color: #e1e8d2;
}

.spot-content {
  min-width: 0;
  position: relative;
}

.spot-title {
  margin: 2px 0 12px;
  font-size: 17px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--olive-950);
  word-break: break-word;
  display: block;
  padding-right: 36px;
}
.favorite-button {
  position: absolute;
  top: -5px;
  right: 0;
  z-index: 2;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 21px;
  line-height: 1;
  cursor: pointer;
}
.spot-name { overflow-wrap: anywhere; }
.favorite-button.active { color: var(--orange-600); }
.spot-description {
  margin: -6px 0 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.poi-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  vertical-align: middle;
}
.poi-badge.verified { color: var(--olive-800); background: #e5ecd9; }
.poi-badge.pending { color: var(--muted); background: var(--sand-200); }

.spot-details {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 18px;
}

.detail-item {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--olive-800);
}

.detail-block {
  width: 100%;
  align-items: flex-start;
}

.detail-label {
  flex: 0 0 auto;
  color: var(--muted);
  margin-right: 7px;
}

.detail-value {
  min-width: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.detail-block :deep(.van-icon) {
  flex: 0 0 auto;
  margin: 3px 6px 0 0;
  font-size: 14px;
  color: var(--olive-500);
}

.time-line {
  position: absolute;
  top: 34px;
  bottom: -18px;
  left: 24px;
  width: 1px;
  background: var(--sand-300);
}

.schedule-slot:last-child .time-line { display: none; }
</style>
