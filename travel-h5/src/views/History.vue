<template>
  <div class="page">
    <van-nav-bar title="历史记录" left-arrow fixed safe-area-inset-top @click-left="goBack" />

    <div class="content">
      <van-empty v-if="sessions.length === 0" description="暂无对话记录">
        <van-button type="primary" @click="goChat">开始对话</van-button>
      </van-empty>

      <div v-else class="virtual-list" @scroll="onScroll">
        <div :style="{ height: `${sessions.length * rowHeight}px` }"></div>
        <div class="virtual-items" :style="{ transform: `translateY(${startIndex * rowHeight}px)` }">
          <van-cell v-for="item in visibleSessions" :key="item.id" :title="item.title"
            :label="formatDate(item.updatedAt)" is-link @click="continueChat(item)" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getChatSessions } from '../utils/travelStorage'

const router = useRouter()
const sessions = ref([])
const rowHeight = 54
const startIndex = ref(0)
const visibleSessions = ref([])

const goBack = () => router.back()

const goChat = () => router.push('/chat')

const formatDate = (dateStr) => {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

const continueChat = (session) => {
  router.push({
    path: '/chat',
    query: {
      sessionId: session.id
    }
  })
}

onMounted(() => {
  sessions.value = getChatSessions()
  visibleSessions.value = sessions.value.slice(0, 12)
})

const onScroll = (event) => {
  startIndex.value = Math.floor(event.target.scrollTop / rowHeight)
  visibleSessions.value = sessions.value.slice(startIndex.value, startIndex.value + 12)
}
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
.virtual-list { position: relative; height: calc(100vh - 70px); overflow-y: auto; }
.virtual-items { position: absolute; inset: 0 0 auto; }
</style>
